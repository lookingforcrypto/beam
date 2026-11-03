# Working on Beam

These instructions apply throughout Beam, including the archived copy at
`upstream/pumpfun-source`. That copy also has its own `AGENTS.md`; follow its
additional archive restrictions. Do not alter the pinned archive for Beam work.

## Start with the current work

Before starting, verify current maintainer direction, task ownership, target
branch, and contribution terms. Apply explicit owner decisions recorded below
before older task snapshots or draft PR prose. Merged code establishes what is
implemented; an open PR establishes only proposed work. If evidence conflicts,
record the conflict in the draft PR and keep the affected behavior disabled
until the owner resolves it. Dated status notes and task ledger entries are
not assignments or approval. A draft PR or passing test does not authorize a
merge or release.

## Current owner decisions and unset values

The owner's 3 November 2026 direction supersedes older draft prose and dated
task snapshots. Beam should evoke the simple pre-PumpSwap launch experience:
create, trade on a visible bonding curve, discover active communities, and
graduate to Raydium AMM v4. This is a product direction, not a claim that the
website, trading client, ranking service, or migration is already live or
identical to Pump.fun. Check current code and PRs before describing availability.

- The planned ordinary Beam allocation is 42/5/3 nominal basis points for
  community/treasury/founder. Creator payouts come **out of the 42-bps
  community share**. The owner deliberately left the creator payout rate
  **unset**; do not select 12 bps or any other rate, add a separate creator
  charge, hard-code an all-in quote, or wire live distribution until the rate,
  recipients, rounding, and custody are reviewed and tested.
- At AMM v4 graduation, burn all LP issued to Beam in the same transaction,
  following the selected historical Raydium pattern. Draft [PR #68](https://github.com/shawkkkkk/beam/pull/68)
  implements a gated adapter and draft [PR #72](https://github.com/shawkkkkk/beam/pull/72)
  adds the burn; neither is merged or activated. Burning LP relinquishes
  Beam's claim to ongoing AMM v4 LP fees. Do not promise post-graduation LP
  revenue, creator fees, or recurring buybacks from that position.
- The creator rate, community-remainder distribution, post-graduation revenue
  source, Token-2022 graduation, non-SOL graduation, fee vault authorities,
  flagship mint/buyback policy, charity design, general pairing support, and
  repository-root license remain unset or unimplemented as described in the
  current code and [economics guide](docs/ECONOMICS.md). Do not fill gaps from
  competitor terms, archived code, sample data, or an unmerged PR. Keep any
  path that depends on an unset decision disabled; name the exact blocker in
  the draft PR and request a reviewed owner decision before activation.

1. Read `README.md`, `docs/STATUS.md`, `docs/ECONOMICS.md`, `docs/TASKS.md`,
   and `CONTRIBUTING.md`. Check the working tree, remote branches, and open
   pull requests before choosing a task. Inspect the intended target branch.
2. Use `programs/beam` as the editable Anchor program. Its retained Pump Main
   modules, Beam policy/economics/Raydium modules, and compatibility tests are
   the contract baseline. Do not start a second launchpad implementation.
3. Claim one bounded lane after checking its open PRs. Recheck the target
   branch and open PRs for overlap before submitting. Record scope, base commit,
   intended behavior, tests, and remaining risks in the PR description. Check
   `docs/TASKS.md` and active pull requests to avoid duplicate work.
   External contributors can follow the [fork-to-PR guide](CONTRIBUTING.md#contribute-from-a-fork)
   without direct write access to Beam.
4. Work in a separate branch. Do not rewrite another contributor's branch or
   merge competing architectures or fee policies without a reviewed decision.
5. Before substantial external contributions, confirm the repository's license
   and contribution terms; archived source notices do not license new Beam code.
6. For website and backend work, choose a bounded lane in `docs/TASKS.md`.
   Define the interface, data source, authorization boundary, acceptance
   behavior, and local tests before enabling an external action. Use public
   behavior/docs for compatibility research, not private source or credential
   collection.

## Source and behavior boundaries

- `upstream/pumpfun-source` pins the community reconstruction at
  `5703df02131ab944408e0cf679b4bef9c22e1a3d`. Its MIT and third-party
  notices stay with the source. `upstream/raydium-cp-swap` pins reference
  Raydium CPMM files at `3d69122790e97cd6aff24e8ba95940793773f58c`.
  Treat both as reference snapshots; edit the Beam program instead.
- `scripts/check_fork.py` verifies archive Git blobs and the declared Beam
  source delta. Document every intentional change to retained Pump source.
  Source equality, host tests, and historical reconstruction receipts do not
  prove Beam's binary identity or full runtime parity with Pump.
- Mayhem creation and enablement are blocked. Legacy PumpSwap migration,
  signed router, and AMM-dependent CTO handlers fail closed. Do not reconnect
  them to PumpSwap or claim that the retained quote-chain code routes through
  Raydium.
- The existing Raydium CPMM migration is a gated, superseded candidate. The
  user chose Raydium AMM v4 and burning Beam-received LP; verify the draft
  adapter, pool state, burn, replay and rollback before activation. Burned LP
  cannot be withdrawn by Beam or harvested for recurring LP fees.
- Durable liquidity is a product goal, not a consequence proved by choosing
  AMM v4. Compare initial and continuing depth, LP ownership/control and
  withdrawal rights, lock/burn tradeoffs, slippage at comparable trade sizes,
  and post-graduation pool behavior. Treat the selected LP burn as binding
  unless the owner changes it; do not promise chart resilience from historical
  Raydium-versus-PumpSwap anecdotes. Comparable
  liquidity and market-period evidence is required to test that hypothesis.
- `beam_economics.rs` contains provisional fee-allocation arithmetic; the
  inherited Pump fee CPI still governs real trade collection. The community
  share's holder-reward/buyback split is a provisional test setting. Holder
  eligibility, the flagship mint, vaults, and distribution rules are open.
  The user's Beam fee split is 42/5/3 nominal basis points for community,
  treasury and founder. Preserve the creator payout and creator-selected
  wallet system. Creator payouts must come from the 42-bps community share;
  the exact creator rate remains unset. Disclose each applicable curve,
  creator, migration, and Raydium pool fee; never promise returns.
- On-chain reconstruction does not provide Pump's website, streaming, callout,
  or charity service backends. Treat those as independent feature work with
  authorized providers; never imply their behavior is byte-identical. The
  pinned archive does contain separate donation-relay and Pump Fees programs;
  their presence is not Beam integration or charity authorization.
- Preserve the desired ability to pair with arbitrary compatible Solana token
  mints and supported contracts, subject to token-program, venue, account and
  security validation. Do not claim every Solana program is a valid pair or
  that general pairing is already implemented. Raydium AMM v4 remains the
  selected graduation venue. Stocks, tokenized stocks and stock-linked pairs
  are outside current scope; no future stock work is scheduled.
- Charity is an open redesign decision. Keep the archived donation source and
  existing capability evidence intact. Do not implement compulsory charity
  deductions, choose a provider/recipient, or assign a new fee share without
  a reviewed product decision. A clearly disclosed optional approach may be
  considered later; no live donation is authorized.
- Seek newcomer clarity and transparent risks. Investigate misleading copycat
  launches, fragmented liquidity across similar narratives, and extraction
  incentives without asserting competitor allegations as fact. Holding-friendly
  design is a goal, not a return guarantee. Do not impose ticker exclusivity,
  launch restrictions, fees or rewards from this direction alone, or promise
  token performance or loss prevention.
- Follow the [Beam visual identity brief](docs/BRAND.md) for the crossbar-free
  curved A mark and restrained 1980s retro-futurist frontend: black primary,
  electric blue secondary and purple tertiary. Preserve accessible data and
  controls, local fonts, mobile layout and reduced-motion behavior. Theme work
  does not activate any product feature or financial mechanism.
- King of the Hill is planned discovery, not an implemented or proven old-Pump
  clone. Verify historical rule and threshold evidence before parity claims.
  Define eligible tokens and curve stages, ranking metric and tie-breaks,
  dethroning/refresh, graduation, data freshness/reorg handling and defenses
  against manipulated inputs. Show an accessible, mobile retro featured area
  only with clearly labeled sample data or authenticated live inputs. No paid
  placement, invented leader, artificial migration delay, investment advice,
  audited-safety implication or return guarantee follows from ranking.
- Keep retro presentation tied to Beam's verified behavior, not a visual wrap
  around PumpSwap. A plain-language "How it works" onboarding explanation
  should use evidenced Beam configuration for graduation, LP custody/burn,
  fees, launch allocations and availability. Do not copy historical threshold
  numbers or assert no presale/team allocation or instant selling from a
  third-party screenshot. Describe LP burning as the selected but unmerged
  Beam policy until its migration PRs land and are validated.
- Keep community discovery simple and give ongoing token communities a fair
  chance to remain visible. Per-token comments or opt-in social features need
  moderation, rate limits and anti-spam checks. Never use fake volume, wash
  trades, automated buy bumps or raid spam to influence ranking or engagement;
  historical status or follower counts alone do not establish legitimacy.
  Preserve planned callouts without implying paid promotion is active. Disclose
  a reward or airdrop's eligibility, funding and timing only after a reviewed
  decision; the $BEAM flagship goal is not a promise to other communities.
- The flagship $BEAM token is intended to launch on Beam, with a very high but
  unquantified share of eligible protocol revenue intended for buybacks and
  burns. No rate, mint, revenue denominator, budget, vault, authority or
  automatic execution is approved. Define actually collected, spendable Beam
  revenue separately from volume, creator entitlements, third-party fees and
  reserved community rewards. Reconcile the goal with 42/5/3 bps and creator
  funding; never double-count funds or overwrite the provisional holder and
  buyback split. A claimed higher share than competitors, including Pump.fun,
  needs comparable bases, periods and realized spending evidence. Do not
  promise price appreciation or describe any buyback as active.
- Support for communities around existing launched tokens is a separate goal
  from flagship $BEAM buybacks. Keep per-token rewards/buybacks, creator fees,
  operating allocations and any promotional spending in distinct, auditable
  budgets from realized receipts. Never count one receipt twice. The balance
  and any promotional policy are unapproved; do not ban callouts, authorize
  new spending, or promise token survival or returns from this goal.

## Validation and review

Run these from the repository root for contract changes:

```sh
python3 scripts/check_fork.py
cargo test --locked --manifest-path programs/beam/Cargo.toml
cargo test --locked --manifest-path programs/beam/Cargo.toml --features experimental-raydium
cargo check --locked --manifest-path programs/beam/Cargo.toml --no-default-features
```

Use pinned lockfiles and inspect setup hooks before installing dependencies.
Review source changes, test output, and the account/fee effects in the pull
request. Host checks do not prove Solana CPI behavior, transaction rollback,
replay resistance, or production safety. Migration and fee-rights changes need
local-validator/SBF evidence and independent review before activation.

Host tests, mock accounts, and local simulations are normal contributor work.
Do not deploy to a live network, use real wallets, sign live transactions,
trade, move funds, collect secrets, or launch live services in a pull request.
A release requires a separate maintainer-controlled process. Respect branch
protections and leave unresolved or untested work in draft state. Before any
merge, follow the [maintainer review sequence](CONTRIBUTING.md#maintainer-review-and-merge)
on the exact head and combined target tree, and satisfy any formal approvals
required by the current branch rule. `main` currently has no mandatory
approval count; this does not replace the owner's review. Do not self-approve
or bypass repository rules.

The owner can queue a reviewed, ready PR for GitHub's protected-branch
auto-merge with the `merge-when-ready` label. Follow
[the auto-merge guide](docs/AUTO_MERGE.md); the label does not replace exact-head
review, required checks, or the separate release decision.

Use GitHub private vulnerability reporting for suspected exploitable issues if
available. If it is unavailable, wait for a private maintainer route. Never
publish findings or sensitive data in a public issue or pull request.
