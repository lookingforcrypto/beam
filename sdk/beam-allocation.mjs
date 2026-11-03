// Development-only mirror of Beam's selected curve-fee allocation. This is
// product policy, not live routing: the retained trade handlers still collect
// through the inherited Pump fee CPI.
//
// Steps 1-3 mirror `beam_economics::allocate` (programs/beam/src/beam_economics.rs):
// one ceiling fee at 50 bps of the curve-trade notional, founder and treasury
// capped at floor(notional * 3 / 10_000) and floor(notional * 5 / 10_000), and
// the remainder to the community. Step 4 is the owner's selected creator rule
// in docs/ECONOMICS.md, which the contract does not implement yet: within the
// community amount, reserve min(community, floor(notional * 35 / 10_000)) for
// the creator-selected wallet.

import { fee } from './beam-quote.mjs';

export const TOTAL_FEE_BPS = 50n;
export const COMMUNITY_NOMINAL_BPS = 42n;
export const TREASURY_NOMINAL_BPS = 5n;
export const FOUNDER_NOMINAL_BPS = 3n;
export const CREATOR_SELECTED_BPS = 35n;

const U64_MAX = (1n << 64n) - 1n;

function u64(value, name) {
  let n;
  if (typeof value === 'bigint') n = value;
  else if (typeof value === 'number' && Number.isSafeInteger(value)) n = BigInt(value);
  else if (typeof value === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(value)) n = BigInt(value);
  else throw new TypeError(`${name} must be a safe integer, bigint, or canonical decimal string`);
  if (n < 0n || n > U64_MAX) throw new RangeError(`${name} must fit u64`);
  return n;
}

export function allocateBeamFee(quoteAmount) {
  const notional = u64(quoteAmount, 'quoteAmount');
  const total = fee(notional, TOTAL_FEE_BPS);
  const founder = (notional * FOUNDER_NOMINAL_BPS) / 10_000n;
  const treasury = (notional * TREASURY_NOMINAL_BPS) / 10_000n;
  const community = total - founder - treasury;
  const creatorCap = (notional * CREATOR_SELECTED_BPS) / 10_000n;
  const creator = community < creatorCap ? community : creatorCap;
  return { total, community, treasury, founder, creator, communityAfterCreator: community - creator };
}
