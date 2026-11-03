import assert from "node:assert/strict";
import test from "node:test";
import { buyQuote, sellQuote, tokensForQuote } from "../../sdk/beam-quote.mjs";
import { allocateBeamFee } from "../../sdk/beam-allocation.mjs";
import {
  LAMPORTS_PER_SOL,
  SAMPLE_CURVE_CONFIG,
  formatPercentBps,
  formatSol,
  formatTokens,
  notionalForSpend,
  parseUnits,
  previewBuy,
  previewSell,
  sampleCurveAtProgress,
  summarizeCurve,
  type CurveState,
} from "../src/tradePreview.ts";

const SOL = LAMPORTS_PER_SOL;

function afterBuy(
  curve: CurveState,
  tokens: bigint,
  quote: bigint,
): CurveState {
  return {
    virtualTokenReserves: curve.virtualTokenReserves - tokens,
    virtualQuoteReserves: curve.virtualQuoteReserves + quote,
    realTokenReserves: curve.realTokenReserves - tokens,
    realQuoteReserves: curve.realQuoteReserves + quote,
    complete: curve.realTokenReserves === tokens,
  };
}

test("sample curves are labelled launch states advanced by one buy", () => {
  const launch = sampleCurveAtProgress(0);
  assert.equal(
    launch.realTokenReserves,
    SAMPLE_CURVE_CONFIG.initialRealTokenReserves,
  );
  assert.equal(launch.realQuoteReserves, 0n);
  assert.equal(summarizeCurve(launch).progressBps, 0n);
  for (const pct of [1, 25, 50, 87, 99]) {
    const curve = sampleCurveAtProgress(pct);
    const summary = summarizeCurve(curve);
    assert.equal(summary.progressBps, BigInt(pct) * 100n, `${pct}%`);
    assert.equal(
      curve.realQuoteReserves,
      curve.virtualQuoteReserves -
        SAMPLE_CURVE_CONFIG.initialVirtualSolReserves,
    );
    assert.equal(
      summary.solToComplete,
      buyQuote(curve, curve.realTokenReserves),
    );
  }
  const half = sampleCurveAtProgress(50);
  const sold = SAMPLE_CURVE_CONFIG.initialRealTokenReserves / 2n;
  assert.equal(
    half.realQuoteReserves,
    buyQuote(launch, sold),
    "one buy_quote from launch",
  );
  const done = sampleCurveAtProgress(100);
  assert.equal(done.complete, true);
  assert.equal(summarizeCurve(done).solToComplete, 0n);
  assert.equal(sampleCurveAtProgress(140).complete, true, "clamped to 100%");
});

test("buy spend never exceeds the entry and buys tokens_for_quote of the curve notional", () => {
  const curve = sampleCurveAtProgress(40);
  for (let i = 0n; i < 1_500n; i++) {
    const spend = 10_000n + i * 7_777_777n;
    const p = previewBuy(curve, spend, 100);
    assert.ok(p.ok && p.side === "buy");
    assert.ok(p.totalSpend <= spend && spend - p.totalSpend <= 1n, `${spend}`);
    assert.equal(
      p.totalSpend,
      p.curveQuote + allocateBeamFee(p.curveQuote).total,
    );
    assert.equal(p.tokensOut, tokensForQuote(curve, p.curveQuote));
    assert.equal(p.minTokensOut, (p.tokensOut * 9_900n) / 10_000n);
    assert.equal(p.fillsCurve, false);
  }
});

test("notionalForSpend is the largest notional whose Beam fee still fits", () => {
  for (const spend of [
    0n,
    1n,
    2n,
    199n,
    200n,
    201n,
    10_050n,
    SOL,
    7n * SOL + 13n,
  ]) {
    const n = notionalForSpend(spend);
    assert.ok(n + allocateBeamFee(n).total <= spend, `${spend}`);
    assert.ok(n + 1n + allocateBeamFee(n + 1n).total > spend, `${spend}`);
  }
});

test("the fill boundary sits exactly at the remaining reserves", () => {
  const curve = sampleCurveAtProgress(95);
  const complete = buyQuote(curve, curve.realTokenReserves);
  const justEnough = complete + 1n + allocateBeamFee(complete + 1n).total;
  const filled = previewBuy(curve, justEnough, 100);
  assert.ok(filled.ok && filled.side === "buy");
  assert.equal(filled.fillsCurve, true);
  assert.equal(filled.tokensOut, curve.realTokenReserves);
  const below = previewBuy(curve, complete - 10_000n, 100);
  assert.ok(below.ok && below.side === "buy");
  assert.equal(below.fillsCurve, false);
  assert.ok(below.tokensOut < curve.realTokenReserves);
});

test("a buy larger than the remaining curve fills it at buy_quote", () => {
  const curve = sampleCurveAtProgress(95);
  const p = previewBuy(curve, 500n * SOL, 100);
  assert.ok(p.ok && p.side === "buy");
  assert.equal(p.fillsCurve, true);
  assert.equal(p.tokensOut, curve.realTokenReserves);
  assert.equal(p.curveQuote, buyQuote(curve, curve.realTokenReserves));
  assert.ok(p.totalSpend < 500n * SOL);
});

test("sells pay sell_quote minus the Beam fee and stay within the curve's SOL", () => {
  const curve = sampleCurveAtProgress(60);
  const circulating =
    SAMPLE_CURVE_CONFIG.initialRealTokenReserves - curve.realTokenReserves;
  for (const tokens of [1_000_000_000n, 50_000_000_000_000n, circulating]) {
    const p = previewSell(curve, tokens, 200);
    assert.ok(p.ok && p.side === "sell");
    assert.equal(p.grossOutput, sellQuote(curve, tokens));
    assert.equal(
      p.netOutput,
      p.grossOutput - allocateBeamFee(p.grossOutput).total,
    );
    assert.equal(p.minSolOutput, (p.netOutput * 9_800n) / 10_000n);
  }
  const all = previewSell(curve, circulating, 0);
  assert.ok(
    all.ok && all.side === "sell" && all.grossOutput <= curve.realQuoteReserves,
    "the curve can always pay a full exit",
  );
  assert.deepEqual(previewSell(curve, circulating + 1n, 100), {
    ok: false,
    error: "exceeds-circulating",
  });
});

test("buying and immediately selling never returns more than was spent", () => {
  const start = sampleCurveAtProgress(30);
  for (const spend of [10_000_000n, SOL, 3n * SOL + 17n, 25n * SOL]) {
    const buy = previewBuy(start, spend, 0);
    assert.ok(buy.ok && buy.side === "buy");
    const next = afterBuy(start, buy.tokensOut, buy.curveQuote);
    const sell = previewSell(next, buy.tokensOut, 0);
    assert.ok(sell.ok && sell.side === "sell");
    assert.ok(sell.netOutput < buy.totalSpend, `${spend}`);
  }
});

test("errors cover empty, dust and completed curves", () => {
  const curve = sampleCurveAtProgress(10);
  assert.deepEqual(previewBuy(curve, 0n, 100), {
    ok: false,
    error: "enter-amount",
  });
  assert.deepEqual(previewBuy(curve, 1n, 100), {
    ok: false,
    error: "too-small",
  });
  assert.deepEqual(previewSell(curve, 0n, 100), {
    ok: false,
    error: "enter-amount",
  });
  const done = sampleCurveAtProgress(100);
  assert.deepEqual(previewBuy(done, SOL, 100), {
    ok: false,
    error: "curve-complete",
  });
  assert.deepEqual(previewSell(done, 1n, 100), {
    ok: false,
    error: "curve-complete",
  });
});

test("the Beam fee breakdown is the selected 50-bps policy", () => {
  const p = previewBuy(sampleCurveAtProgress(20), 10n * SOL, 100);
  assert.ok(p.ok && p.side === "buy");
  const n = p.curveQuote;
  assert.equal(p.fee.creator, (n * 35n) / 10_000n);
  assert.equal(p.fee.founder, (n * 3n) / 10_000n);
  assert.equal(p.fee.treasury, (n * 5n) / 10_000n);
  assert.equal(
    p.fee.creator +
      p.fee.communityAfterCreator +
      p.fee.treasury +
      p.fee.founder,
    p.fee.total,
  );
});

test("units parse strictly and format for humans", () => {
  assert.equal(parseUnits("1.5", 9), 1_500_000_000n);
  assert.equal(parseUnits(".25", 9), 250_000_000n);
  assert.equal(parseUnits("10", 6), 10_000_000n);
  for (const bad of ["", ".", "-1", "1e3", "1.0000000001", "abc", "1.2.3"])
    assert.equal(parseUnits(bad, 9), null, bad);
  assert.equal(formatSol(1_500_000_000n), "1.5 SOL");
  assert.equal(formatSol(85_005_359_056n), "85.005359 SOL");
  assert.equal(formatSol(42n), "42 lamports");
  assert.equal(formatSol(0n), "0 SOL");
  assert.equal(formatTokens(34_612_903_192_310n), "34.61M");
  assert.equal(formatTokens(1_234_560n), "1.23");
  assert.equal(formatTokens(4_356_000_000_000n), "4.35M");
  assert.equal(formatTokens(10_000_000_000_000n), "10.00M");
  assert.equal(formatPercentBps(8_700n), "87.00%");
  assert.equal(formatPercentBps(5n), "0.05%");
});
