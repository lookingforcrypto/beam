# Community-first economics

The user selected a **50-basis-point nominal Beam allocation**: 42 bps for a
community allocation, 5 bps for treasury, and 3 bps for founder. Preserve the
creator payout and creator-selected wallet system. Creator payouts must be
funded **inside the 42-bps community share**, not by an additional charge.
The selected creator rate is **35 bps of curve-trade notional**; the other
community uses have a nominal 7 bps. These are product requirements, not
active on-chain fee routing or an all-in trade quote.

The choice is five basis points above Pump.fun's [published 30-bps curve creator
fee](https://pump.fun/docs/fees). Float's [published schedule](https://www.floatlaunch.xyz/docs#fees)
gives creators 5% of its fee after Raydium's 25-bps curve cut, or at most
11.25 bps of notional at its 2.5% tier. These are dated curve comparisons,
not a claim that Beam offers higher lifetime creator earnings: Float says its
fee split continues after graduation, while Beam's selected burned-LP model
does not collect a new post-graduation creator fee. Verify current competitor
terms before making any public comparative claim.

## Rounding

Use the same quote-amount input for every split leg as
`beam_economics::allocate`; it must be the actual quote-token trade notional
used to compute the Beam component, not a second gross or net base.

1. Compute the Beam allocation fee once with Pump's retained ceiling-fee routine at 50 bps.
2. Cap the founder share at `floor(trade_notional × 3 / 10,000)` and the treasury share at `floor(trade_notional × 5 / 10,000)`.
3. Give the remainder to the community.
4. Within the actual community amount, reserve `min(community, floor(trade_notional × 35 / 10,000))` for the creator-selected wallet. The rest remains community funds; its beneficiary split is not selected.

As an illustration of the allocation math alone, on 100 SOL notional this
component is 0.5 SOL: 0.42 for the community share **before its creator
payout**, 0.05 treasury, and 0.03 founder. The creator would receive 0.35 SOL
from the community amount, leaving 0.07 SOL there. This is **not an all-in
trade quote**: the inherited collection path, migration charges, and venue
fees are not reconciled into an executable quote. On a one-lamport trade,
the rounded component is one lamport, with zero creator lamports.
Quotes must disclose effective fees on dust trades and every applicable fee.

`beam_economics.rs` implements only Beam component allocation arithmetic. It
is not yet wired into the recovered fee-program CPI, recipient routing or an
executable keeper. The current inherited trade code calculates creator fees
separately; that describes the present source and **must not become a second
creator charge in Beam's final policy**. Beam-controlled configuration and
vaults must preserve and test creator payout semantics with the selected rate
and creator-selected recipient. The 42/5/3 split is not an enforced live trading
fee today.

The requested direction uses the community allocation for creator payouts,
holder rewards and flagship buybacks. Holder rewards and buybacks draw only
from the amount left after the creator payout. A 50/50 split of that remainder is a
provisional test setting, not deployed economics. Holder eligibility, the
flagship mint, recipient vaults, and execution rules have not been selected.

## Flagship $BEAM goal, not an active mechanism

The flagship $BEAM token is intended to launch on Beam. The user wants a very
high but **unquantified** share of eligible protocol revenue devoted to $BEAM
buybacks and burns. The initial numeric suggestion was withdrawn; there is no
approved rate or minimum. The ambition to allocate more than competitors,
including Pump.fun, is unverified. A public comparison would need the same
revenue denominator and time period, and must separate committed budgets from
realized buyback spending and burns with reliable sources.

For planning, protocol revenue means realized receipts from Beam-controlled
fee sources after applicable obligations, refunds and costs. Its eligible
streams, measurement period and exact netting rules still need approval. Trade
volume is not revenue; Raydium's third-party pool fees, creator entitlements,
reserved holder rewards, and treasury/founder allocations cannot silently be
reassigned to flagship spending. Reconcile the base and budget with the 42/5/3-bps split,
the 35-bps creator take and the provisional community holder/buyback split
without double-counting. The actual rate, $BEAM mint, vaults, authorities,
execution safeguards and auditable receipts remain undecided. No token launch,
buyback, trade or burn is authorized by this document. Buybacks do not ensure
price appreciation or a self-sustaining return cycle.

Existing launched-token communities also need a separate, reviewable support
budget; flagship $BEAM buybacks are not the whole ecosystem policy. Track each
actual receipt and its allocation once, with auditable lines for per-token
rewards/buybacks, creator entitlements, operating funds, flagship spending and
any disclosed promotion. The relative amounts and any callout/promotion budget
are undecided. This does not ban callouts or authorize promotional payments,
and it cannot promise that existing tokens survive or produce returns.

## After graduation

Raydium charges its selected on-chain pool configuration. Beam cannot invent a Raydium share such as 0.10%. Quotes must distinguish Raydium pool fees, curve creator fees, Beam fees, and migration fees. The selected historical model charges **no new Beam fee on AMM v4 trades** after graduation; the curve's 50 bps must not be stacked on top. The user selected Raydium AMM v4; the existing gated CPMM migration code is a superseded candidate and does not satisfy that venue requirement.

Recurring buybacks need a collectible fee source. The owner selected burning
all Beam-received LP at AMM v4 graduation, following the historical Raydium
pattern. Draft [PR #68](https://github.com/shawkkkkk/beam/pull/68) contains
the gated adapter and draft [PR #72](https://github.com/shawkkkkk/beam/pull/72)
adds the burn; neither is merged or active. Burning LP removes Beam's
withdrawal and ongoing LP-fee claim. Raydium AMM v4 has no Beam-controlled
creator or protocol fee switch, and its LP fee accrues in pool reserves for
holders of LP. Raydium's [Burn & Earn](https://docs.raydium.io/user-flows/burn-and-earn)
does not support AMM v4. An unclaimed balance from pre-graduation curve trades
should remain claimable by its creator after graduation, subject to the
reviewed vault authority and payout path. No new creator, community or
buyback receipt arises from AMM v4 trading under this policy. Do not fund
recurring promises from burned LP. Only actually collected pre-graduation
receipts can fund obligations in the selected model; a future revenue source
would require a separate owner decision and review.

Liquidity durability needs evidence beyond a venue name: measure pool depth at
initialization and over time, LP custody and withdrawal rights, lock/burn
tradeoffs, price impact for comparable trade sizes, and behavior after
graduation. Compare the same market periods and liquidity conditions before
attributing chart differences to Raydium versus PumpSwap. The historical
durability claim is a hypothesis, not a verified causal result or guarantee.

Before activation:

- Verify that the AMM v4 migration burns exactly the LP issued to Beam in the
  same transaction, leaves no LP balance or supply, and rolls back on failure.
  Do not describe burned LP as continuing fee income.
- Deny creators, operators and keepers authority to withdraw liquidity
  principal; the burn is the selected principal-protection mechanism.
- Quote the actual Raydium pool fee and show zero new Beam creator/community
  fee after graduation.
- Route any approved flagship proceeds to a dedicated vault, with public buyback and burn receipts; no automatic execution is approved.
- Bound slippage, price manipulation, account substitutions and keeper reimbursement; isolate execution costs from liquidity principal.

No volume means no revenue or buybacks. A continuing policy does not guarantee returns, price appreciation, execution frequency or perpetual revenue. This is required design work, not completed functionality.
