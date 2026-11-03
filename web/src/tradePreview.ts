// Local, sample-only trade ticket arithmetic for the preview's token page.
//
// Curve math comes from sdk/beam-quote.mjs, which mirrors the program's
// buy_quote, sell_quote and tokens_for_quote. The Beam fee comes from
// sdk/beam-allocation.mjs: the owner-selected 50-bps allocation
// (beam_economics::allocate plus the 35-bps creator rule in
// docs/ECONOMICS.md). That allocation is selected policy, not live routing;
// the retained handlers still collect through the inherited fee path. Nothing
// here reads chain state, connects a wallet, signs or submits.
import {
  buyQuote,
  sellQuote,
  tokensForQuote,
  minSolOutputWithSlippage,
} from "../../sdk/beam-quote.mjs";
import {
  allocateBeamFee,
  type BeamFeeAllocation,
} from "../../sdk/beam-allocation.mjs";

export const LAMPORTS_PER_SOL = 1_000_000_000n;
export const TOKEN_DECIMALS = 6;
const TOKEN_UNIT = 10n ** BigInt(TOKEN_DECIMALS);
const BPS = 10_000n;

/**
 * Sample configuration for preview arithmetic only. Beam's launch reserves
 * are not configured in source; these equal the synthetic Global values used
 * by tests/legacy-trade-runtime.
 */
export const SAMPLE_CURVE_CONFIG = {
  initialVirtualTokenReserves: 1_073_000_000_000_000n,
  initialVirtualSolReserves: 30_000_000_000n,
  initialRealTokenReserves: 793_100_000_000_000n,
  tokenTotalSupply: 1_000_000_000_000_000n,
} as const;
export type CurveConfig = typeof SAMPLE_CURVE_CONFIG;

export type CurveState = {
  virtualTokenReserves: bigint;
  virtualQuoteReserves: bigint;
  realTokenReserves: bigint;
  realQuoteReserves: bigint;
  complete: boolean;
};

export const SLIPPAGE_CHOICES_BPS = [50, 100, 200, 500] as const;

/** Curve state after one sample buy of `progressPercent` of the real reserves. */
export function sampleCurveAtProgress(
  progressPercent: number,
  config: CurveConfig = SAMPLE_CURVE_CONFIG,
): CurveState {
  const pct = Math.min(100, Math.max(0, Math.round(progressPercent)));
  const launch: CurveState = {
    virtualTokenReserves: config.initialVirtualTokenReserves,
    virtualQuoteReserves: config.initialVirtualSolReserves,
    realTokenReserves: config.initialRealTokenReserves,
    realQuoteReserves: 0n,
    complete: false,
  };
  const sold = (config.initialRealTokenReserves * BigInt(pct)) / 100n;
  if (sold === 0n) return launch;
  const cost = buyQuote(launch, sold);
  return {
    virtualTokenReserves: launch.virtualTokenReserves - sold,
    virtualQuoteReserves: launch.virtualQuoteReserves + cost,
    realTokenReserves: launch.realTokenReserves - sold,
    realQuoteReserves: cost,
    complete: launch.realTokenReserves === sold,
  };
}

export type CurveSummary = {
  tokensAvailable: bigint;
  solInCurve: bigint;
  progressBps: bigint;
  /** Curve cost to buy every remaining token, before any Beam fee. */
  solToComplete: bigint;
  complete: boolean;
};

export function summarizeCurve(
  curve: CurveState,
  config: CurveConfig = SAMPLE_CURVE_CONFIG,
): CurveSummary {
  const sold = config.initialRealTokenReserves - curve.realTokenReserves;
  return {
    tokensAvailable: curve.realTokenReserves,
    solInCurve: curve.realQuoteReserves,
    progressBps: (sold * BPS) / config.initialRealTokenReserves,
    solToComplete:
      curve.realTokenReserves > 0n
        ? buyQuote(curve, curve.realTokenReserves)
        : 0n,
    complete: curve.complete || curve.realTokenReserves === 0n,
  };
}

export type TicketError =
  | "enter-amount"
  | "too-small"
  | "curve-complete"
  | "exceeds-circulating";

export type BuyPreview = {
  ok: true;
  side: "buy";
  /** Lamports the curve receives. */
  curveQuote: bigint;
  fee: BeamFeeAllocation;
  /** curveQuote + Beam fee; never above the amount entered. */
  totalSpend: bigint;
  tokensOut: bigint;
  minTokensOut: bigint;
  /** True when the entry exceeds the remaining curve and is clamped to it. */
  fillsCurve: boolean;
};

export type SellPreview = {
  ok: true;
  side: "sell";
  grossOutput: bigint;
  fee: BeamFeeAllocation;
  netOutput: bigint;
  minSolOutput: bigint;
};

export type TicketResult =
  | BuyPreview
  | SellPreview
  | { ok: false; error: TicketError };

/**
 * Largest curve notional n with n + Beam fee(n) <= spend. For the 50-bps
 * ceiling fee the closed form is already exact; the two loops only guard
 * against a future rate change (the fee is monotonic in n).
 */
export function notionalForSpend(spend: bigint): bigint {
  let n = (spend * BPS) / (BPS + 50n);
  while (n > 0n && n + allocateBeamFee(n).total > spend) n -= 1n;
  while (n + 1n + allocateBeamFee(n + 1n).total <= spend) n += 1n;
  return n;
}

export function previewBuy(
  curve: CurveState,
  spendLamports: bigint,
  slippageBps: number,
): TicketResult {
  if (curve.complete || curve.realTokenReserves === 0n)
    return { ok: false, error: "curve-complete" };
  if (spendLamports <= 0n) return { ok: false, error: "enter-amount" };
  let curveQuote = notionalForSpend(spendLamports);
  // tokens_for_quote reserves one lamport, so a one-lamport quote buys nothing.
  if (curveQuote < 2n) return { ok: false, error: "too-small" };
  let tokensOut = tokensForQuote(curve, curveQuote);
  let fillsCurve = false;
  if (tokensOut >= curve.realTokenReserves) {
    tokensOut = curve.realTokenReserves;
    curveQuote = buyQuote(curve, tokensOut);
    fillsCurve = true;
  }
  if (tokensOut === 0n) return { ok: false, error: "too-small" };
  const fee = allocateBeamFee(curveQuote);
  const slip = BigInt(slippageBps);
  return {
    ok: true,
    side: "buy",
    curveQuote,
    fee,
    totalSpend: curveQuote + fee.total,
    tokensOut,
    minTokensOut: (tokensOut * (BPS - slip)) / BPS,
    fillsCurve,
  };
}

export function previewSell(
  curve: CurveState,
  tokenAmount: bigint,
  slippageBps: number,
  config: CurveConfig = SAMPLE_CURVE_CONFIG,
): TicketResult {
  if (curve.complete) return { ok: false, error: "curve-complete" };
  if (tokenAmount <= 0n) return { ok: false, error: "enter-amount" };
  if (tokenAmount > config.initialRealTokenReserves - curve.realTokenReserves)
    return { ok: false, error: "exceeds-circulating" };
  const grossOutput = sellQuote(curve, tokenAmount);
  const fee = allocateBeamFee(grossOutput);
  if (grossOutput <= fee.total) return { ok: false, error: "too-small" };
  const netOutput = grossOutput - fee.total;
  return {
    ok: true,
    side: "sell",
    grossOutput,
    fee,
    netOutput,
    minSolOutput: minSolOutputWithSlippage(netOutput, slippageBps),
  };
}

// ---------------------------------------------------------------- formatting

/** Parse a decimal SOL or token string into integer base units. */
export function parseUnits(input: string, decimals: number): bigint | null {
  const value = input.trim();
  if (!/^\d{0,12}(\.\d*)?$/.test(value) || value === "" || value === ".")
    return null;
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > decimals) return null;
  return (
    BigInt(whole || "0") * 10n ** BigInt(decimals) +
    BigInt(fraction.padEnd(decimals, "0") || "0")
  );
}

function trimDecimals(units: bigint, decimals: number, shown: number): string {
  const scale = 10n ** BigInt(decimals);
  const whole = units / scale;
  const fraction = (units % scale)
    .toString()
    .padStart(decimals, "0")
    .slice(0, shown)
    .replace(/0+$/, "");
  return fraction
    ? `${whole.toLocaleString("en-US")}.${fraction}`
    : whole.toLocaleString("en-US");
}

export function formatSol(lamports: bigint): string {
  if (lamports > 0n && lamports < 10_000n) return `${lamports} lamports`;
  return `${trimDecimals(lamports, 9, 6)} SOL`;
}

export function formatTokens(units: bigint): string {
  const whole = units / TOKEN_UNIT;
  if (whole >= 1_000_000n) {
    const hundredths = (units * 100n) / (TOKEN_UNIT * 1_000_000n);
    const cents = (hundredths % 100n).toString().padStart(2, "0");
    return `${(hundredths / 100n).toLocaleString("en-US")}.${cents}M`;
  }
  return trimDecimals(units, TOKEN_DECIMALS, 2);
}

export function formatPercentBps(bps: bigint): string {
  return `${bps / 100n}.${(bps % 100n).toString().padStart(2, "0")}%`;
}
