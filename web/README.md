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

## Launch cost estimate

The create form shows what a `create_v2` launch would cost the creator, and
updates as the name, symbol and URI are typed:

- the rent for the Token-2022 mint with on-mint metadata, the bonding curve
  and the curve token account;
- the two signature fees.

`src/launchCost.ts` computes the estimate. It matches observed `create_v2`
executions in `../tests/legacy-trade-runtime/fixtures/launch-cost.json`. The
rent stays in the new accounts and is not a Beam fee. The form still saves a
local draft only.
