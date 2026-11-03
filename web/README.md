# Beam website preview

This is a static, local product preview adapted from the separate draft PR #3.
It displays sample market data and saves draft ideas in browser storage. Its
creator wallet, donate.gg, callout, and livestream fields are local plans only.
No chain RPC, wallet connection, metadata upload, donation, stream, or trading
action is present. The selected Raydium AMM v4 adapter and Beam fee collection
are not implemented by this preview.

The [visual identity brief](../docs/BRAND.md) defines the crossbar-free arch
mark, black/blue/purple palette and restrained retro-futurist theme. The
transparent SVG assets live in `public/`; `src/theme-retro.css` layers the
visual treatment over the existing preview without changing sample data or
adding a remote font or service.

```sh
npm ci --prefix web
npm run build --prefix web
npm run test:unit --prefix web
npm run format:check --prefix web
```

For local browser interaction tests, install a compatible Chromium browser and
run `npm run test:browser --prefix web`. The test starts a loopback Vite preview
and uses synthetic browser state; it does not submit a transaction.

The website and backend contribution lanes are in [the task ledger](../docs/TASKS.md).

## Trade preview (sample curve)

A non-draft token's detail view shows a pre-PumpSwap style trade ticket. It
has Buy/Sell tabs, quick amounts and max slippage, and a bonding-curve
summary: tokens still for sale, SOL in the curve, the cost to finish, and the
selected Raydium AMM v4 graduation with LP burn.

- **Numbers.** `src/tradePreview.ts` computes every number locally. Curve math
  comes from `../sdk/beam-quote.mjs` and the owner-selected 0.50% Beam
  allocation from `../sdk/beam-allocation.mjs`.
- **Sample data.** The curve is a sample state derived from the card's
  progress, using the synthetic reserves of `tests/legacy-trade-runtime`.
  Beam's launch reserves are not configured.
- **No live actions.** The trade button stays disabled. There is no wallet,
  RPC, signing or submission.
