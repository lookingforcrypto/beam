# Local bonding-curve quotes

Lane baseline: Beam main `c707f3022f947572b20f730ccae11a8ccb8da52a`.
This lane owns `beam-quote.mjs`, its fixture producer, fixtures and tests. It
does not change the Anchor program, immutable archives, economics, fee policy,
website or Raydium adapter.

```sh
node --test sdk/beam-quote.test.mjs
```

## Interface

All amounts are `bigint`. Inputs accept a bigint, a safe integer or a
canonical decimal string that fits u64. `curve` is the object returned by
`decodeCurrentBondingCurve` in `beam-native.mjs`.

| Export | Mirrors | Result |
| --- | --- | --- |
| `buyQuote(curve, amount)` | `buy_quote` (lib.rs) | Quote needed for `amount` base units: `floor(a·vQ / (vT − a)) + 1`. |
| `sellQuote(curve, amount)` | `BondingCurve::sell_quote` | Gross quote for `amount` base units: `floor(vQ·a / (vT + a))`. |
| `tokensForQuote(curve, quote)` | `tokens_for_quote` | Base units for `quote − 1` via `constant_product::output`. |
| `fee(amount, bps)` | `fee_math::fee` | `ceil(amount·bps / 10 000)`; must fit u64. |
| `tradeFees({...})` | the local part of `trade_fees` / `get_fees` | Protocol and creator fees once the bps are known. |
| `previewLegacyBuy({...})` | legacy `buy` handler order | `tokenAmount`, `solCost`, fees and `totalCost`. |
| `previewLegacySell({...})` | legacy `sell` handler order | `tokenAmount`, `grossOutput`, fees and `netOutput`. |
| `previewBuyExactQuoteInV2({...})` | native path of `buy_exact_quote_in_v2` | Spend at most `spendableQuoteIn`: `tokenAmount`, `quote`, fees and `totalCost`. |
| `maxSolCostWithSlippage`, `minSolOutputWithSlippage` | not program code | Instruction bounds, rounded in the trader's favour. |

Failures throw `QuoteError`. Its `code` is the program's `PumpError` variant:
`Overflow`, `DivisionByZero`, `Truncation`, `BondingCurveComplete`,
`BuyZeroAmount`, `NotEnoughTokensToBuy`, `SellZeroAmount`,
`BuyNotEnoughSolToCoverFees` or `BuySlippageBelowMinTokensOut`.

The preview functions apply checks in the order the handlers use:

- **Buy:** completion check, then the optional partial-fill clamp to
  `realTokenReserves`, then the zero and reserve checks, then `buy_quote` as
  u64, then fees on that cost.
- **Sell:** completion check, then the zero check, then `sell_quote` as u64,
  then fees subtracted from the gross output.

- **Exact SOL in (`buy_exact_quote_in_v2`, native SOL).** The steps are:
  1. `minTokensOut > 0`, then `spendableQuoteIn > 0`.
  2. `raw = input · 10 000 / (10 000 + protocol bps + creator bps)`. The
     creator bps count only when the curve has a creator.
  3. Both ceiling fees are charged on `raw`.
  4. The quote is trimmed when rounding pushes `raw + fees` over the input.
  5. Tokens are `tokensForQuote(quote)`. With partial fill, a fill beyond the
     real reserves is clamped and re-quoted with `buyQuote`.
  6. `minTokensOut` is enforced.

  Once fees are charged on `raw`, the handler's second trim branch cannot
  change the result.

`previewLegacyBuy` / `previewLegacySell` also describe the native-SOL
`buy_v2` / `sell_v2` handlers. They use the same check order, quote and fee
arithmetic. `tests/legacy-trade-runtime` (merged through PR #64) executes both
families and confirms the deltas.

## Fees are an explicit input

For legacy trades, the program gets `(protocol_fee_bps, creator_fee_bps)`
from a CPI to the inherited Pump fee program (`get_fees_with_quote_mint`). It
then computes the amounts locally:

- When `global.creator_fee_configurable` is set and the curve's
  `creator_fee_bps` is nonzero, the curve's value replaces the returned
  creator bps.
- A curve whose creator is the zero key pays no creator fee.

`tradeFees` reproduces only that local step. Its inputs are
`protocolFeeBps`, `creatorFeeBps` and `creatorFeeConfigurable`, and callers
must supply all three. They are never defaulted. `feeExempt: true` models the
handler's whitelist-PDA path, which pays no fees.

The fee CPI source is unresolved for Beam. Its vaults, recipients and the
creator take are open owner decisions. These helpers do not implement
Beam's planned 0.50% fee, the 42/5/3 split or any all-in quote. Raydium
pool fees and migration charges are separate.

## Evidence

`fixtures/quote.json` is the unedited stdout of
`tools/generate-quote-fixtures.rs`, run as a temporary example of the locked
`beam-program` crate. The output contains:

- `buy_quote`, `sell_quote` and `tokens_for_quote` for 9 curve states and
  12 amounts each, including error results.
- `fee_math::fee` for 110 amount/bps pairs, including u64 truncation.
- `fee_math::get_fees` for 160 combinations of the creator-fee flag, the
  curve creator, curve bps, tier bps and amount.

`fixtures/quote.receipt.json` records the command, the toolchain and the
SHA-256 of the source and the output. The tests recheck both hashes.

`fixtures/quote-exact-in.json` is not a restated formula. It records 20
executions of the real `buy_exact_quote_in_v2` handler on one native-SOL curve
in a local bank, using the synthetic 95/30-bps fee program. The cases cover
the zero-limit and zero-input errors, sub-fee inputs, the trim path at
1 000 000 014 lamports, a non-partial over-reserve buy (`NotEnoughTokensToBuy`),
a partial fill that completes the curve, and a buy after completion. Each case
records the observed tokens, the curve's quote delta, the fee and buyback
recipients' combined delta and the creator-vault delta, or the program error.
`previewBuyExactQuoteInV2` matches every one. The producer is the ignored test
`tests/legacy-trade-runtime/tests/exact_in_fixture.rs`, now on `main` through
PR #64. `quote-exact-in.receipt.json` pins the producer commit, its SHA-256 and
the output hash. The test suite rechecks the in-tree producer against that
hash. Two runs at the producer commit, and a third on `main` at `0a3ba8d`,
produced identical bytes:

```sh
cd tests/legacy-trade-runtime
cargo test --locked --test exact_in_fixture -- --ignored --nocapture | sed -n 's/^@@//p'
```

## Not covered

- **Handler composition.** The order and checks in the previews come from
  reading the handler source. A synthetic local bank test of the handlers
  themselves would be stronger evidence.
- **Chain state.** The helpers read nothing from chain. The caller's token
  balance, `global.whitelist_pda`, the fee CPI result and curve freshness
  must come from an authenticated source.
- **Other paths.** V3, non-SOL quote-mint, Token-2022 quote transfer-fee,
  Mayhem and cashback trades are not modelled.
- **No execution.** There is no RPC, wallet, signing or transaction
  submission. A quote is not a guarantee of execution.

## Selected-policy allocation (`beam-allocation.mjs`)

`allocateBeamFee(notional)` returns the owner-selected 50-bps Beam component
for one curve-trade notional:

- **Total, founder, treasury, community.** These four mirror
  `beam_economics::allocate` exactly: one ceiling fee at 50 bps; founder
  capped at `floor(n · 3 / 10 000)`; treasury capped at
  `floor(n · 5 / 10 000)`; the remainder to the community.
- **Creator.** The creator reservation follows docs/ECONOMICS.md step 4:
  `min(community, floor(n · 35 / 10 000))`, with the rest left for other
  community uses. The contract does not implement this step yet.

This is selected policy, not live routing. The retained handlers still collect
through the inherited fee CPI. `fixtures/allocation.json` is the unedited
stdout of `tools/generate-allocation-fixtures.rs`: 68 notionals passed through
`beam_economics::allocate` in the locked crate, with a receipt. The tests also
check lamport conservation and the ECONOMICS examples. `beam-quote.d.mts` and
`beam-allocation.d.mts` declare the types the TypeScript web preview imports.
