import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  QuoteError, buyQuote, sellQuote, tokensForQuote, fee, tradeFees,
  previewLegacyBuy, previewLegacySell, maxSolCostWithSlippage, minSolOutputWithSlippage,
  previewBuyExactQuoteInV2,
} from './beam-quote.mjs';

const fixtureBytes = readFileSync(new URL('./fixtures/quote.json', import.meta.url));
const fixture = JSON.parse(fixtureBytes);
const receipt = JSON.parse(readFileSync(new URL('./fixtures/quote.receipt.json', import.meta.url)));
const CREATOR = 'US517G5965aydkZ46HS38QLi7UQiSojurfbQfKCELFx'; // [7; 32]
const ZERO = '11111111111111111111111111111111';

const curveOf = (c, extra = {}) => ({
  virtualTokenReserves: BigInt(c.virtualTokenReserves), virtualQuoteReserves: BigInt(c.virtualQuoteReserves),
  realTokenReserves: BigInt(c.realTokenReserves), realQuoteReserves: BigInt(c.realQuoteReserves),
  complete: false, creator: CREATOR, creatorFeeBps: 0n, ...extra,
});
const launch = curveOf(fixture.curves.find((c) => c.name === 'launch'));

function expectResult(actual, expected, label) {
  if (typeof expected === 'string') {
    assert.equal(actual(), BigInt(expected), label);
  } else {
    assert.throws(actual, (error) => error instanceof QuoteError && error.code === expected.error, label);
  }
}

test('fixture bytes match the recorded Rust producer receipt', () => {
  assert.equal(createHash('sha256').update(fixtureBytes).digest('hex'), receipt.stdoutSha256);
  assert.equal(fixtureBytes.length, receipt.stdoutBytes);
  const source = readFileSync(new URL('./tools/generate-quote-fixtures.rs', import.meta.url));
  assert.equal(createHash('sha256').update(source).digest('hex'), receipt.sourceSha256);
});

test('curve quotes match buy_quote, sell_quote and tokens_for_quote, including errors', () => {
  let cases = 0;
  for (const c of fixture.curves) {
    const curve = curveOf(c);
    for (const k of c.cases) {
      const label = `${c.name} @ ${k.amount}`;
      expectResult(() => buyQuote(curve, k.amount), k.buyQuote, `buy ${label}`);
      expectResult(() => sellQuote(curve, k.amount), k.sellQuote, `sell ${label}`);
      expectResult(() => tokensForQuote(curve, k.amount), k.tokensForQuote, `tokensFor ${label}`);
      cases += 3;
    }
  }
  assert.ok(cases >= 300);
});

test('fee matches fee_math::fee, including u64 truncation', () => {
  for (const f of fixture.fees) {
    expectResult(() => fee(f.amount, f.basisPoints), f.fee, `${f.amount} @ ${f.basisPoints}`);
  }
  assert.ok(fixture.fees.some((f) => typeof f.fee === 'object'));
});

test('fee composition matches fee_math::get_fees', () => {
  for (const f of fixture.tradeFees) {
    const curve = { ...launch, creator: f.creator, creatorFeeBps: BigInt(f.curveCreatorFeeBps) };
    const actual = tradeFees({
      curve, quoteAmount: f.quoteAmount, protocolFeeBps: f.protocolFeeBps,
      creatorFeeBps: f.creatorFeeBps, creatorFeeConfigurable: f.creatorFeeConfigurable,
    });
    assert.deepEqual(actual, {
      protocolFee: BigInt(f.protocolFee), creatorFee: BigInt(f.creatorFee),
      protocolFeeBps: BigInt(f.effectiveProtocolFeeBps), creatorFeeBps: BigInt(f.effectiveCreatorFeeBps),
    }, JSON.stringify(f));
  }
  assert.ok(fixture.tradeFees.some((f) => f.creator === ZERO && f.creatorFee === '0' && f.creatorFeeBps !== '0'));
  assert.ok(fixture.tradeFees.some((f) => f.creatorFeeConfigurable && f.effectiveCreatorFeeBps === '77'));
});

test('legacy buy preview follows the handler order and its checks', () => {
  const fees = { protocolFeeBps: 95, creatorFeeBps: 5, creatorFeeConfigurable: false };
  const preview = previewLegacyBuy({ curve: launch, amount: 1_000_000_000, partialFill: false, ...fees });
  const solCost = buyQuote(launch, 1_000_000_000);
  assert.equal(preview.solCost, solCost);
  assert.equal(preview.protocolFee, fee(solCost, 95));
  assert.equal(preview.creatorFee, fee(solCost, 5));
  assert.equal(preview.totalCost, solCost + preview.protocolFee + preview.creatorFee);

  const clamped = previewLegacyBuy({ curve: launch, amount: launch.realTokenReserves + 1n, partialFill: true, ...fees });
  assert.equal(clamped.tokenAmount, launch.realTokenReserves);
  assert.throws(() => previewLegacyBuy({ curve: launch, amount: launch.realTokenReserves + 1n, partialFill: false, ...fees }), { code: 'NotEnoughTokensToBuy' });
  assert.throws(() => previewLegacyBuy({ curve: launch, amount: 0, partialFill: false, ...fees }), { code: 'BuyZeroAmount' });
  assert.throws(() => previewLegacyBuy({ curve: { ...launch, realTokenReserves: 0n }, amount: 5, partialFill: true, ...fees }), { code: 'BuyZeroAmount' });
  assert.throws(() => previewLegacyBuy({ curve: { ...launch, complete: true }, amount: 1, partialFill: false, ...fees }), { code: 'BondingCurveComplete' });

  const exempt = previewLegacyBuy({ curve: launch, amount: 1_000_000_000, partialFill: false, feeExempt: true });
  assert.equal(exempt.totalCost, solCost);
  assert.throws(() => previewLegacyBuy({ curve: launch, amount: 1, partialFill: false }), TypeError, 'bps are never defaulted');
});

test('legacy sell preview subtracts fees from the gross output', () => {
  const fees = { protocolFeeBps: 95, creatorFeeBps: 5, creatorFeeConfigurable: false };
  const preview = previewLegacySell({ curve: launch, amount: 1_000_000_000, ...fees });
  const gross = sellQuote(launch, 1_000_000_000);
  assert.equal(preview.grossOutput, gross);
  assert.equal(preview.netOutput, gross - fee(gross, 95) - fee(gross, 5));
  assert.throws(() => previewLegacySell({ curve: launch, amount: 0, ...fees }), { code: 'SellZeroAmount' });
  assert.throws(() => previewLegacySell({ curve: { ...launch, complete: true }, amount: 1, ...fees }), { code: 'BondingCurveComplete' });
  assert.throws(() => previewLegacySell({ curve: launch, amount: 1_000_000_000, ...fees, protocolFeeBps: 20_000 }), { code: 'Overflow' });
  const noCreator = previewLegacySell({ curve: { ...launch, creator: ZERO }, amount: 1_000_000_000, ...fees });
  assert.equal(noCreator.creatorFee, 0n);
});

test('slippage bounds round toward trader protection', () => {
  assert.equal(maxSolCostWithSlippage(10_001, 100), 10_102n); // 10101.01 rounds up
  assert.equal(maxSolCostWithSlippage(10_000, 0), 10_000n);
  assert.equal(minSolOutputWithSlippage(10_001, 100), 9_900n); // 9900.99 rounds down
  assert.equal(minSolOutputWithSlippage(10_000, 10_000), 0n);
  assert.throws(() => minSolOutputWithSlippage(1, 10_001), RangeError);
  assert.throws(() => maxSolCostWithSlippage((1n << 64n) - 1n, 1), { code: 'Truncation' });
});

test('inputs are strict integers', () => {
  for (const bad of [-1, 1.5, '01', '1e3', 2n ** 64n, null]) {
    assert.throws(() => buyQuote(launch, bad), /amount/);
  }
  assert.equal(buyQuote({ ...launch, virtualTokenReserves: '1073000000000000' }, 1_000_000_000), buyQuote(launch, 1_000_000_000));
  assert.throws(() => buyQuote({ ...launch, virtualTokenReserves: -1n }, 1), /virtualTokenReserves/);
  assert.throws(() => buyQuote(null, 1), TypeError);
});

const exactInBytes = readFileSync(new URL('./fixtures/quote-exact-in.json', import.meta.url));
const exactIn = JSON.parse(exactInBytes);
const exactInReceipt = JSON.parse(readFileSync(new URL('./fixtures/quote-exact-in.receipt.json', import.meta.url)));

test('exact-quote-in fixture bytes match the recorded runtime receipt', () => {
  assert.equal(createHash('sha256').update(exactInBytes).digest('hex'), exactInReceipt.stdoutSha256);
  assert.equal(exactInBytes.length, exactInReceipt.stdoutBytes);
});

test('buy_exact_quote_in_v2 preview matches every executed handler observation', () => {
  const fees = { protocolFeeBps: exactIn.protocolFeeBps, creatorFeeBps: exactIn.creatorFeeBps, creatorFeeConfigurable: exactIn.creatorFeeConfigurable };
  let ok = 0;
  let failed = 0;
  for (const o of exactIn.observations) {
    const curve = { ...curveOf(o.curve, { complete: o.curve.complete }), creator: exactIn.creator, creatorFeeBps: 0n };
    const run = () => previewBuyExactQuoteInV2({
      curve, spendableQuoteIn: o.spendableQuoteIn, minTokensOut: o.minTokensOut, partialFill: o.partialFill, ...fees,
    });
    const label = `${o.spendableQuoteIn} / min ${o.minTokensOut} / partial ${o.partialFill}`;
    if (o.error) {
      assert.throws(run, (e) => e instanceof QuoteError && e.code === o.error, label);
      failed++;
    } else {
      const p = run();
      assert.deepEqual(
        { tokenAmount: p.tokenAmount, quote: p.quote, protocolFee: p.protocolFee, creatorFee: p.creatorFee },
        Object.fromEntries(Object.entries(o.result).map(([k, v]) => [k, BigInt(v)])),
        label,
      );
      assert.ok(p.totalCost <= BigInt(o.spendableQuoteIn), `${label}: never spends more than the input`);
      ok++;
    }
  }
  assert.ok(ok >= 10 && failed >= 5, 'fixture covers fills and failures');
  assert.ok(exactIn.observations.some((o) => o.partialFill && o.result), 'fixture covers a partial fill');
});

test('exact-quote-in preview invariants hold off the fixture grid', () => {
  const fees = { protocolFeeBps: 95, creatorFeeBps: 30, creatorFeeConfigurable: false };
  for (let i = 0n; i < 2_000n; i++) {
    const input = 1_000_000n + i * 7_919n;
    const p = previewBuyExactQuoteInV2({ curve: launch, spendableQuoteIn: input, minTokensOut: 1, partialFill: false, ...fees });
    assert.ok(p.totalCost <= input && input - p.totalCost <= 1n, `${input}: spends the input, within one lamport`);
    assert.equal(p.tokenAmount, tokensForQuote(launch, p.quote));
    const raw = (input * 10_000n) / 10_125n;
    assert.equal(p.protocolFee, fee(raw, 95), 'fees stay on the untrimmed quote');
  }
  const exempt = previewBuyExactQuoteInV2({ curve: launch, spendableQuoteIn: 1_000_000_000, minTokensOut: 1, partialFill: false, feeExempt: true });
  assert.equal(exempt.quote, 1_000_000_000n);
  assert.equal(exempt.totalCost, 1_000_000_000n);
  const noCreator = previewBuyExactQuoteInV2({ curve: { ...launch, creator: ZERO }, spendableQuoteIn: 1_000_000_000, minTokensOut: 1, partialFill: false, ...fees });
  assert.equal(noCreator.creatorFee, 0n);
  assert.equal(noCreator.quote, (1_000_000_000n * 10_000n) / 10_095n);
  assert.throws(() => previewBuyExactQuoteInV2({ curve: launch, spendableQuoteIn: 1, minTokensOut: 1, partialFill: false }), TypeError, 'bps are never defaulted');
});
