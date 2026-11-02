# Legacy trade local bank

This crate runs Beam's native-SOL `create_v2`, legacy `buy` and legacy `sell`
handlers inside a `solana-program-test` 2.2.1 bank. It loads Beam as a native
processor, in the same way as the draft `tests/runtime-harness`.

```sh
cd tests/legacy-trade-runtime
cargo test --locked
cargo test --locked --features experimental-raydium
```

It runs no SBF build, live network, wallet or deployed program. It is not a
Beam fee path. The lockfile starts from the draft runtime harness's resolved
versions. Only this package's name and its direct `anchor-spl` dependency
differ.

## Synthetic setup

- **`Global`.** Deserialized from zeroed bytes, then given the Pump launch
  reserves (1.073e15 virtual tokens, 30 SOL virtual, 7.931e14 real tokens,
  1e15 supply). It also sets `create_v2_enabled`, one fee recipient, eight
  copies of one buyback recipient, and 2,000 buyback bps.
- **Fee program.** The inherited Pump fee program (`pfeeUx…`) is replaced by
  a synthetic processor. That processor checks the `get_fees_with_quote_mint`
  arguments and returns 95 protocol / 30 creator bps. These numbers are test
  inputs, not Beam or Pump policy. The fee CPI source and Beam's fee custody
  remain open owner decisions.
- **`fee_config` and `global_volume_accumulator`.** Both are injected at their
  PDAs, with Anchor discriminators.

## What the tests show

1. **Create, then trade at exact bounds.** `create_v2` initialises the curve
   from `Global` with Token-2022, mints the full supply to the curve ATA and
   revokes the mint authority.
   - `buy` succeeds when `max_sol_cost` equals `buy_quote` plus fees. It fails
     with `TooMuchSolRequired` one lamport below that.
   - `sell` succeeds when `min_sol_output` equals `sell_quote` minus fees. It
     fails with `TooLittleSolReceived` one lamport above that.
   - Curve reserves change by exactly the quote. The user receives the net
     amount. The fee recipient, buyback recipient and creator vault receive
     the protocol remainder, the floor of the buyback share, and the creator
     fee. On the first buy, the creator vault is also topped up to rent
     exemption.
   - Expected values come from the program's own pure `buy_quote`,
     `sell_quote` and `fee_math::fee`.
2. **Partial fill and completion.** With partial fill, a buy is clamped to
   `real_token_reserves` and completes the curve. Without partial fill, it
   fails with `NotEnoughTokensToBuy`. After completion, both buy and sell
   fail with `BondingCurveComplete`.
3. **Rejected inputs.** The 16 base buy metas without remaining accounts are
   rejected with `BuybackFeeRecipientMissing`. A substituted fee recipient
   fails with `NotAuthorized`, and a creator vault derived from another key
   fails with `ConstraintSeeds`. Zero-amount buys and sells are rejected.

## Remaining accounts

Legacy `buy` and `sell` read `remaining_accounts[0]` as the
`["bonding-curve-v2", mint]` PDA. They check its key only when a creator fee
is charged. They read `remaining_accounts[1]` as a buyback recipient listed
in `Global.buyback_fee_recipients`. The SDK `buildBuy` / `buildSell` helpers
return only the base metas, so a client must append both accounts.

## Not covered

- Real fee-program behaviour, fee tiers by market cap, or Beam's planned
  0.50% / 42-5-3 policy.
- Whitelist-PDA trades, cashback, holder rewards, Mayhem, quote-mint and
  V2/V3 handlers, and volume tracking.
- Migration after completion, an SBF binary, compute-unit limits or a
  deployed program.
