# Beam native-SOL ABI fixtures

`beam-native.mjs` is a dependency-free, local-only encoder for the retained
legacy `create`, `buy`, and `sell` instruction data and ordered Anchor account
metas at Beam contract commit `65c96b5`. It also covers `create_v2` at
`c8dc348` and decodes the raw `CompleteEvent` payload and current 166-byte
`BondingCurve` account. Run:

```sh
node --test sdk/beam-native.test.mjs
```

The golden instruction bytes in `fixtures/native-sol.json` came from
`beam_program::instruction::{Create,Buy,Sell}.data()`. The signer/writable
flags and order came from
`beam_program::accounts::{Create,LegacyBuy,LegacySell}.to_account_metas(None)`
under Anchor 0.31.1. The event bytes came from `CompleteEvent::data()` and the
curve bytes from `BondingCurve::try_serialize`. The fixture uses synthetic
public keys and `.invalid` metadata URL; it is never a transaction example.

`fixtures/create-v2.json` was generated with a temporary Rust harness linked
to the compiled `beam-program` at `c8dc348`. Its instruction bytes came from
`beam_program::instruction::CreateV2.data()` and its 16 ordered metas from
`beam_program::accounts::CreateV2.to_account_metas(None)` under Anchor 0.31.1.
The fixture uses synthetic keys, including inert Mayhem account slots and an
`.invalid` metadata URI. `encodeCreateV2` takes `creatorFeeBps` as a u64
bigint, safe integer, or decimal string. It enforces the contract's 32/13/200
UTF-8 byte limits and rejects Mayhem and deprecated cashback creation. Holder
rewards remain an allowed flag, but the program replaces the supplied creator
with a holder-rewards PDA when that flag is enabled and requires global holder
rewards to be enabled. For native SOL creation, the handler uses its fee
schedule and does not apply a caller-supplied configurable creator fee rate.

These helpers **do not** derive or verify PDAs, associated token accounts,
fee recipients, token program ownership, remaining accounts, signatures,
global feature settings, or on-chain state. `CreateV2` uses Token-2022 and its
normal-mode ABI still requires the retained Mayhem account slots; the builder
does not populate or verify their canonical addresses. In particular,
inherited Pump `fee_config` and `fee_program` accounts remain unresolved in
both legacy buy/sell and `buy_v2`/`sell_v2`; those trade handlers expect
additional validated remaining accounts. A CreateV2 fixture does not make
subsequent trading executable. The builders return base
account metadata for inspection and testing, not an executable Beam client.
The development program ID is not deployed. No RPC, wallet, signing, or live
trade code is present.

`decodeCurrentBondingCurve` intentionally rejects historical shorter curve
layouts that the Rust program can read; it accepts only exactly 166 bytes of
the current serialized layout. Neither decoder verifies the account owner or
that a payload came from a trusted transaction. Check those separately when a
real client is designed.

## Address derivation (`beam-pdas.mjs`)

`beam-pdas.mjs` is a dependency-free, synchronous derivation module for the
account slots that the builders above leave to the caller. Run:

```sh
node --test sdk/beam-pdas.test.mjs
```

It implements Solana's `create_program_address` / `find_program_address`
(bumps 255 down to 1, as Solana does) with its own SHA-256 and the
curve25519-dalek point-decompression rule. On top of that it derives the
Beam PDAs named in the Anchor constraints of `Create`, `CreateV2`,
`LegacyBuy` and `LegacySell`: `global`, `mint-authority`,
`__event_authority`, `global_volume_accumulator`, `bonding-curve`,
`creator-vault` and `user_volume_accumulator`. It also derives the Metaplex
metadata PDA, the three retained Mayhem slots that `CreateV2` checks with
`seeds::program = MAYHEM_ID`, and associated token addresses for SPL Token
and Token-2022. The `resolve*Accounts` helpers return an `accounts` object
that the matching `build*` function accepts.

`fixtures/pdas.json` is the unedited stdout of `tools/generate-pda-fixtures.rs`,
linked to the locked `beam-program` crate at `c707f30`. It uses
`Pubkey::find_program_address`, spl-associated-token-account and
`Pubkey::is_on_curve` with synthetic inputs and the program IDs compiled
into the crate. `fixtures/pdas.receipt.json` records the command, toolchain
and the SHA-256 of the source and output. The tests check those hashes, every
PDA and ATA, and 106 curve-membership vectors, including the sign bit,
non-canonical `y` and the identity point.

Boundaries:

- Derivation reads no chain state. It does not show that an account exists,
  is owned by the expected program or holds valid data.
- The inherited Pump `feeRecipient`, `feeConfig` and `feeProgram` accounts
  remain unresolved for Beam. The trade resolvers require them explicitly
  and never default them.
- The trade resolvers also require `creator`, which must be the decoded
  bonding curve's `creator` field, and `tokenProgram`, which must be the
  mint's owner. They cannot verify either value.
- `associatedUser` defaults to the user's associated token account. The
  program accepts any token account for that mint, and this module does not
  create one.
- `CreateV2`'s `mayhem_token_vault` is unconstrained in Beam, so the caller
  must supply it.
- No RPC, wallet, signing or transaction submission is present. The program
  ID is still the undeployed development placeholder.
