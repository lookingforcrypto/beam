// Development-only, dependency-free bonding-curve quote arithmetic for the
// retained native-SOL legacy `buy` and `sell` handlers in programs/beam/src/lib.rs.
// Pure integer math mirrors `buy_quote`, `BondingCurve::sell_quote`,
// `tokens_for_quote`, `fee_math::fee` and the local fee composition after the
// fee CPI. It reads no chain state and is not a guarantee of execution.
//
// The protocol and creator basis points for legacy trades come from a CPI to
// the inherited Pump fee program (`get_fees_with_quote_mint`). That source is
// unresolved for Beam, so callers must pass the bps explicitly; nothing here
// defaults or guesses a Beam fee. This is NOT Beam's planned 0.50% fee.

const U64_MAX = (1n << 64n) - 1n;
const BPS = 10_000n;
const ZERO_PUBKEY = '11111111111111111111111111111111';

// Error codes reuse the program's `PumpError` variant names.
export class QuoteError extends RangeError {
  constructor(code, message = code) {
    super(message);
    this.name = 'QuoteError';
    this.code = code;
  }
}

function u64(value, name) {
  let n;
  if (typeof value === 'bigint') n = value;
  else if (typeof value === 'number' && Number.isSafeInteger(value)) n = BigInt(value);
  else if (typeof value === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(value)) n = BigInt(value);
  else throw new TypeError(`${name} must be a safe integer, bigint, or canonical decimal string`);
  if (n < 0n || n > U64_MAX) throw new RangeError(`${name} must fit u64`);
  return n;
}

function bool(value, name) {
  if (typeof value !== 'boolean') throw new TypeError(`${name} must be boolean`);
  return value;
}

function toU64(value) {
  if (value > U64_MAX) throw new QuoteError('Truncation');
  return value;
}

function reserves(curve) {
  if (curve === null || typeof curve !== 'object') throw new TypeError('curve must be a decoded BondingCurve');
  return {
    virtualTokenReserves: u64(curve.virtualTokenReserves, 'curve.virtualTokenReserves'),
    virtualQuoteReserves: u64(curve.virtualQuoteReserves, 'curve.virtualQuoteReserves'),
    realTokenReserves: u64(curve.realTokenReserves, 'curve.realTokenReserves'),
    realQuoteReserves: u64(curve.realQuoteReserves, 'curve.realQuoteReserves'),
  };
}

// `buy_quote`: quote needed for `amount` base tokens, rounded up by one unit.
// Returns u128 as the program does; the legacy handler then requires u64.
export function buyQuote(curve, amount) {
  const { virtualTokenReserves: vt, virtualQuoteReserves: vq } = reserves(curve);
  const a = u64(amount, 'amount');
  if (a > vt) throw new QuoteError('Overflow');
  const denominator = vt - a;
  if (denominator === 0n) throw new QuoteError('DivisionByZero');
  return (a * vq) / denominator + 1n;
}

// `BondingCurve::sell_quote`: gross quote returned for `amount` base tokens.
export function sellQuote(curve, amount) {
  const { virtualTokenReserves: vt, virtualQuoteReserves: vq } = reserves(curve);
  const a = u64(amount, 'amount');
  const denominator = vt + a;
  if (denominator === 0n) throw new QuoteError('DivisionByZero');
  return (vq * a) / denominator;
}

// `tokens_for_quote`: base tokens for a quote input, after reserving one unit.
export function tokensForQuote(curve, quote) {
  const { virtualTokenReserves: vt, virtualQuoteReserves: vq } = reserves(curve);
  const q = u64(quote, 'quote');
  if (q === 0n) throw new QuoteError('Overflow');
  const effective = q - 1n;
  const denominator = vq + effective;
  if (denominator === 0n) throw new QuoteError('DivisionByZero');
  return (effective * vt) / denominator;
}

// `fee_math::fee`: ceil(amount * bps / 10_000), required to fit u64.
export function fee(amount, basisPoints) {
  const value = (u64(amount, 'amount') * u64(basisPoints, 'basisPoints') + BPS - 1n) / BPS;
  return toU64(value);
}

// Local fee composition after the fee CPI returns (protocol, creator) bps:
// a configurable nonzero curve creator fee overrides the returned creator bps,
// and a curve without a creator pays no creator fee.
export function tradeFees({ curve, quoteAmount, protocolFeeBps, creatorFeeBps, creatorFeeConfigurable }) {
  const configurable = bool(creatorFeeConfigurable, 'creatorFeeConfigurable');
  const curveCreatorBps = u64(curve.creatorFeeBps, 'curve.creatorFeeBps');
  if (typeof curve.creator !== 'string' || !curve.creator) throw new TypeError('curve.creator must be a base58 pubkey');
  const protocolBps = u64(protocolFeeBps, 'protocolFeeBps');
  const effectiveCreatorBps = configurable && curveCreatorBps !== 0n ? curveCreatorBps : u64(creatorFeeBps, 'creatorFeeBps');
  const protocolFee = fee(quoteAmount, protocolBps);
  const creatorFee = curve.creator !== ZERO_PUBKEY ? fee(quoteAmount, effectiveCreatorBps) : 0n;
  return { protocolFee, creatorFee, protocolFeeBps: protocolBps, creatorFeeBps: effectiveCreatorBps };
}

function feesOrExempt(input, quoteAmount) {
  if (input.feeExempt === true) {
    return { protocolFee: 0n, creatorFee: 0n, protocolFeeBps: 0n, creatorFeeBps: 0n };
  }
  if (input.feeExempt !== undefined && input.feeExempt !== false) throw new TypeError('feeExempt must be boolean');
  return tradeFees({ ...input, quoteAmount });
}

function liveCurve(curve) {
  if (bool(curve.complete, 'curve.complete')) throw new QuoteError('BondingCurveComplete');
}

// Follows the legacy `buy` handler's order: complete check, optional partial
// fill clamp, zero/real-reserve checks, `buy_quote`, then fees on that cost.
// `maxSolCost` must be at least `totalCost` for the handler to accept it.
export function previewLegacyBuy(input) {
  const { curve, amount, partialFill } = input;
  liveCurve(curve);
  const { realTokenReserves } = reserves(curve);
  let tokens = u64(amount, 'amount');
  if (bool(partialFill, 'partialFill') && tokens > realTokenReserves) tokens = realTokenReserves;
  if (tokens === 0n) throw new QuoteError('BuyZeroAmount');
  if (realTokenReserves < tokens) throw new QuoteError('NotEnoughTokensToBuy');
  const solCost = toU64(buyQuote(curve, tokens));
  const fees = feesOrExempt(input, solCost);
  const totalCost = solCost + fees.protocolFee + fees.creatorFee;
  if (totalCost > U64_MAX) throw new QuoteError('Overflow');
  return { tokenAmount: tokens, solCost, ...fees, totalCost };
}

// Follows the legacy `sell` handler: complete check, zero check, `sell_quote`,
// then fees subtracted from that gross output. `minSolOutput` must not exceed
// `netOutput`. The caller's token balance is chain state and is not checked.
export function previewLegacySell(input) {
  const { curve, amount } = input;
  liveCurve(curve);
  const tokens = u64(amount, 'amount');
  if (tokens === 0n) throw new QuoteError('SellZeroAmount');
  const grossOutput = toU64(sellQuote(curve, tokens));
  const fees = feesOrExempt(input, grossOutput);
  const netOutput = grossOutput - fees.protocolFee - fees.creatorFee;
  if (netOutput < 0n) throw new QuoteError('Overflow');
  return { tokenAmount: tokens, grossOutput, ...fees, netOutput };
}

// Follows the native-SOL path of `buy_exact_quote_in_handler`
// (programs/beam/src/buy_v2.rs): spend at most `spendableQuoteIn` lamports.
// The quote is grossed down by the effective protocol + creator bps, both
// ceiling fees are charged on that untrimmed quote, and the quote is trimmed
// if rounding pushes the total over the input. With `partialFill`, a fill
// beyond the real reserves is clamped and re-quoted with `buyQuote`.
// `feeExempt: true` models the whitelist-PDA path. Token-2022 quote transfer
// fees and non-SOL quote mints are not modelled.
export function previewBuyExactQuoteInV2(input) {
  const { curve, spendableQuoteIn, minTokensOut, partialFill } = input;
  liveCurve(curve);
  const { realTokenReserves } = reserves(curve);
  const limit = u64(minTokensOut, 'minTokensOut');
  const available = u64(spendableQuoteIn, 'spendableQuoteIn');
  const partial = bool(partialFill, 'partialFill');
  if (limit === 0n) throw new QuoteError('BuyZeroAmount');
  if (available === 0n) throw new QuoteError('BuyNotEnoughSolToCoverFees');

  let protocolBps = 0n;
  let creatorBps = 0n;
  let quote;
  let protocolFee = 0n;
  let creatorFee = 0n;
  let computed;
  const hasCreator = curve.creator !== ZERO_PUBKEY;
  if (input.feeExempt === true) {
    quote = available;
    computed = toU64(tokensForQuote(curve, available));
  } else {
    if (input.feeExempt !== undefined && input.feeExempt !== false) throw new TypeError('feeExempt must be boolean');
    ({ protocolFeeBps: protocolBps, creatorFeeBps: creatorBps } = tradeFees({ ...input, quoteAmount: available }));
    const totalBps = protocolBps + (hasCreator ? creatorBps : 0n);
    const raw = totalBps === 0n ? available : toU64((available * BPS) / (BPS + totalBps));
    if (raw === 0n) throw new QuoteError('BuyNotEnoughSolToCoverFees');
    protocolFee = fee(raw, protocolBps);
    creatorFee = hasCreator ? fee(raw, creatorBps) : 0n;
    const total = raw + protocolFee + creatorFee;
    quote = raw;
    if (total > available) {
      quote = raw - (total - available);
      if (quote < 0n) throw new QuoteError('Overflow');
      if (quote === 0n) throw new QuoteError('BuySlippageBelowMinTokensOut');
    }
    computed = toU64(tokensForQuote(curve, quote));
  }

  let tokenAmount;
  if (computed > realTokenReserves && partial) {
    tokenAmount = realTokenReserves;
    quote = toU64(buyQuote(curve, tokenAmount));
    protocolFee = fee(quote, protocolBps);
    creatorFee = hasCreator ? fee(quote, creatorBps) : 0n;
    if (available < quote + protocolFee + creatorFee) throw new QuoteError('TooMuchSolRequired');
  } else {
    tokenAmount = computed;
    const total = quote + protocolFee + creatorFee;
    if (total > U64_MAX) throw new QuoteError('Overflow');
    if (total > available) {
      quote -= total - available;
      if (quote < 0n) throw new QuoteError('BuyNotEnoughSolToCoverFees');
      if (quote === 0n) throw new QuoteError('BuySlippageBelowMinTokensOut');
      tokenAmount = toU64(tokensForQuote(curve, quote));
    }
    if (tokenAmount < limit) throw new QuoteError('BuySlippageBelowMinTokensOut');
  }
  if (realTokenReserves < tokenAmount) throw new QuoteError('NotEnoughTokensToBuy');
  return {
    tokenAmount, quote, protocolFee, creatorFee, totalCost: quote + protocolFee + creatorFee,
    protocolFeeBps: protocolBps, creatorFeeBps: creatorBps,
  };
}

// Slippage bounds for the instruction arguments. Rounding always favors the
// trader's protection: max cost rounds up, min output rounds down.
export function maxSolCostWithSlippage(totalCost, slippageBps) {
  const bps = u64(slippageBps, 'slippageBps');
  return toU64((u64(totalCost, 'totalCost') * (BPS + bps) + BPS - 1n) / BPS);
}

export function minSolOutputWithSlippage(netOutput, slippageBps) {
  const bps = u64(slippageBps, 'slippageBps');
  if (bps > BPS) throw new RangeError('slippageBps must be at most 10000');
  return (u64(netOutput, 'netOutput') * (BPS - bps)) / BPS;
}
