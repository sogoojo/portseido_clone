# Portseido Lite — Architecture & Handoff Guide

This document is written for a developer or coding agent picking up the project. It explains how the code is organised, how data flows, the non-obvious conventions, and the operational details (deployment, cron, how the NGX broker data was loaded). Read `CLAUDE.md` too — it is the enforced house-rules file.

---

## 1. The one idea that explains everything

**The `transactions` table is the single source of truth.** Every number the app shows — holdings, cost basis, market value, day/all-time P&L, allocation, returns, rebalance deltas, the S&P counterfactual — is *derived* from transactions by replaying them. There is no "holdings" or "positions" table. If you want to change what the app shows, you almost always add/edit transactions, not a computed table.

A transaction is:

```ts
type TransactionType = 'buy' | 'sell' | 'deposit' | 'withdrawal' | 'dividend';
interface Transaction {
  id; account_id; date; type; ticker; quantity; price_per_unit;
  amount; currency; commission; notes; created_at;
}
```

Conventions baked into the math:
- **buy/sell:** `amount = quantity × price_per_unit` (the principal). Fees go in `commission`, separately. For a buy the cash out is `amount + commission`; for a sell the cash in is `amount − commission`.
- **dividend:** `ticker` set, `amount` = net cash received, `quantity`/`price_per_unit` optional (shares × per-share), withholding tax noted in `notes`.
- **deposit/withdrawal:** `ticker` null, `amount` = cash moved. Note the type is `withdrawal` (not "withdraw").

---

## 2. Tech stack & layout

- **Next.js 16 App Router**, **React 19**, **TypeScript strict**.
- **better-sqlite3** — *synchronous* SQLite. There are no async DB calls; queries are prepared statements executed inline. No ORM — raw SQL by design.
- **Tailwind v4** (light mode only), **Recharts v3** (all charts), **Vitest** (service-layer tests).

```
src/
  app/
    (pages)/page.tsx        # dashboard(/), performance, allocation, transactions,
                            # watchlist, rebalance, radar, summaries
    api/**/route.ts         # thin HTTP wrappers over services; return {data} | {error,message}
  components/<feature>/*.tsx # React components grouped by feature
  lib/
    db.ts                   # SQLite connection + idempotent schema/migration/seed (see §6)
    schema.sql              # all tables (loaded by db.ts on boot)
    types.ts                # ALL shared types live here
    hooks.ts                # useApi<T>() — client fetch hook w/ abort + debounce
    seed*.ts                # first-run seed: accounts, watchlist, targets
    services/               # ALL business logic
      import/               # per-broker CSV parsers -> common Transaction
scripts/                    # one-off / cron entrypoints (tsx)
.github/workflows/          # cron pingers (NOT deploy) -> hit /api/cron/* on Fly
Dockerfile, fly.toml        # Fly.io deploy (standalone Next output)
```

**Architectural rule:** API routes are thin. They parse the request, call one or more services, and shape the response. All logic lives in `src/lib/services/`. If you're writing business logic in a route handler, move it to a service.

---

## 3. The service layer (`src/lib/services/`)

| Service | Responsibility |
|---|---|
| `portfolio.ts` | **The core.** FIFO cost basis, holdings, per-account & aggregate value, day P&L, all-time P&L (realised+unrealised+dividends), total deposited. |
| `prices.ts` | Current & historical prices. **Routes** each ticker to Yahoo or TradingView. 15-min cache (2h for NGX). Also `ensureMetadata()` for ticker_metadata. |
| `fx.ts` | FX conversion (`convert(amount, from, to)`), Yahoo FX symbols, 15-min cache. Pairs: EUR/USD/NGN in both directions. |
| `history.ts` | Historical valuation replay (value-over-time chart, period MWR, historical returns). FIFO replay + historical prices + historical FX to USD. |
| `returns.ts` | Period MWR (Newton-Raphson IRR over dated cash flows) built on `history.ts`. |
| `benchmark.ts` | S&P 500 counterfactual: "what if your deposits went into SPY on the same dates?" |
| `tickers.ts` | `getKnownTickers()` (picker options) + `searchTickers()` (live Yahoo symbol search). |
| `import/` | CSV parsers (`degiro.ts`, extendable) via `index.ts` registry -> common `Transaction`. |
| `splits.ts` | Auto-detect Yahoo split events; restate stored data once (guarded by `applied_splits`). |
| `watchlist.ts`, `targets.ts` | Watchlist (tiered, target-entry buy signals) and rebalance target weights. |
| `theses.ts` | Per-holding thesis + pre-committed sell triggers (auto/manual). Discipline layer. |
| `rotation.ts` | Sector-rotation radar universe + heatmap data. |
| `summaries.ts` | End-of-day US/EU price + free analyst/fundamental signals (Yahoo quoteSummary). |
| `ngx-summaries.ts`, `ngx-news.ts`, `ngx-fundamentals.ts` | NGX equivalent: TradingView candles + scanner fundamentals + Nigerian-press RSS. |
| `notes.ts`, `reminders.ts`, `telegram.ts` | Action items / reminders + price-trigger alerts, delivered over Telegram. |
| `tradingview.ts` | NGX price fetch via `@mathieuc/tradingview` (anonymous websocket, daily candles). |

### Price routing (important)
`prices.ts` decides Yahoo vs TradingView per ticker:
- NGX tickers start with `NSENG:` (or have `market='ngx'` in metadata) → **TradingView** daily candles, keyed off `fetched_at` freshness (candles are dated by trading day; 2h staleness).
- Everything else (US/EU/crypto/FX/benchmarks) → **Yahoo**, 15-min staleness.
- `yahooSymbol()` is currently a pass-through: tickers are stored already in Yahoo format (e.g. `AAPL`, `VWCE.DE`, `BTC-USD`). Adding a genuinely new ticker no longer requires knowing the exchange suffix — the transaction form's `TickerCombobox` calls `/api/tickers/search` (live Yahoo search) so e.g. `QDVE` resolves to `QDVE.DE`. Yahoo search has **no NGX coverage**; NGX still uses the manual `NSENG:` convention.

### Multi-currency & the NGX isolation (read before touching totals)
Accounts are EUR, USD, or NGN. Aggregate ("all") views convert to USD (and EUR on the dashboard) via live FX.

**NGX (any NGN account) is deliberately excluded from every aggregate figure** so its naira value is never merged into the EUR/USD totals. This is implemented once in `portfolio.ts` via:
```ts
const ISOLATED_CURRENCY = 'NGN';
const AGG_CCY_FILTER = `AND a.currency != '${ISOLATED_CURRENCY}'`;
```
applied in the aggregate branches of `getHoldings`, `getAllTimePnL`, `getTotalDeposited`, and `getAggregateValue` (which keeps NGX in the `accounts[]` list but out of `total_eur/total_usd`). `getDailyPnL` inherits it via `getHoldings`. The same `AND a.currency != 'NGN'` filter is mirrored in `history.ts` (`buildValuationContext`) and `benchmark.ts` (counterfactual). Single-account views (`?account=ngx`) are unaffected — NGX is fully visible there. If you add another isolated currency, thread it through those five spots.

---

## 4. Request flow (example)

`GET /api/portfolio?account=all`:
1. Route calls `getAggregateValue()`, `getHoldings()`, `getDailyPnL()`, `getAllTimePnL()`, `getTotalDeposited()`.
2. Each reads transactions, runs `computeFIFO()` per (ticker, account), fetches current prices (`prices.ts`, cached), converts via `fx.ts`.
3. Aggregate branch excludes NGN accounts (see §3). Returns `{ data: { total_eur, total_usd, accounts[], holdings[], pnl, all_time_pnl, total_deposited } }`.
4. Client pages use `useApi<T>(url)` (`hooks.ts`) which aborts stale requests on account switch.

The account selector persists via the `?account=` URL param across all pages.

---

## 5. Data model (tables in `schema.sql`)

- `accounts` — the 6 fixed accounts (`id`, `name`, `broker`, `currency`, `track_cash`).
- `transactions` — **source of truth** (see §1).
- `price_cache` / `fx_cache` — cached quotes/rates keyed `(ticker|pair, date)` with `fetched_at`.
- `ticker_metadata` — name/sector/industry/asset_type/market/currency per ticker (auto-filled by `ensureMetadata` on first price fetch; NGX gets a stub).
- `daily_summaries` — EOD price + rich free analyst/fundamental signals (recommendation, targets, PE/PEG/beta, revisions, insider net, JSON trend blobs) + `news`.
- `watchlist`, `targets` — tiered watchlist w/ target-entry; per-ticker rebalance target %.
- `portfolio_notes` — action items; optional `remind_at` (time) or `trigger_price`+`trigger_direction` (price) → Telegram, `notified_at` fires once.
- `theses` — per-holding thesis + JSON `triggers` (pre-committed sell rules).
- `applied_splits` — guards against double-applying a stock split.
- `ngx_news`, `ngx_fundamentals` — NGX press headlines + TradingView scanner fundamentals.
- `app_meta`, `_migrations` — small KV store + migration ledger.

---

## 6. Boot, migrations & seeding (`db.ts`)

`db.ts` opens the connection at module-eval time and, in one idempotent pass:
- sets `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=20000`;
- runs `schema.sql` (all `CREATE TABLE IF NOT EXISTS`);
- applies additive `ALTER TABLE` migrations (duplicate-column tolerant) and *data* migrations tracked once in `_migrations`;
- seeds accounts / watchlist / targets via `OR IGNORE`.

The whole thing is wrapped in a **retry-on-lock loop**: `next build` spawns several page-data workers that each init the fresh DB simultaneously, and the WAL/DDL exclusive lock isn't reliably covered by `busy_timeout`. Because every step is idempotent, retrying is safe and fixes the race. If you change boot logic, keep every step idempotent.

---

## 7. Deployment & operations

- **Host:** Fly.io app `portseido-lite` (Amsterdam). Build = `Dockerfile` (multi-stage → Next.js `output: 'standalone'`). DB persists on a Fly **volume** mounted at `/app/data`.
- **Deploy:** manual — `fly deploy`. There is **no** CI/CD auto-deploy. The GitHub workflows are *pingers*, not deployers.
- **Cron (external):** GitHub Actions POST to the running app, guarded by the `CRON_SECRET` header:
  - `daily-summaries.yml` → `/api/cron/daily-summaries` (evening UTC; upserts on `(ticker,date)` so a duplicate run is a no-op — resilient to GitHub's best-effort scheduler). Also refreshes the Radar universe, NGX summaries, and runs the split check.
  - `reminders.yml` → `/api/cron/reminders` (hourly; delivers due reminders/price alerts via Telegram, stamps `notified_at`).
- **Env vars (Fly secrets):** `CRON_SECRET` (required for cron), and Telegram (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`) if you want pushes. No market-data keys — Yahoo & TradingView are keyless.

### Inspecting / editing the production DB
The live data lives only on the Fly volume (it is **not** in git). Pattern used in this project:
```bash
# read-only probe
fly ssh sftp shell    # put a probe.js into /tmp
fly ssh console -C "node /tmp/probe.js"   # require('/app/node_modules/better-sqlite3')('/app/data/portseido-lite.db')
```
Always `cp` a `*.pre-<change>-<date>` backup of `/app/data/portseido-lite.db` before a write, insert atomically inside a `db.transaction`, then verify via the live API. Because data isn't in git, a volume rebuild loses it — code always redeploys from GitHub, data does not.

---

## 8. Loading data directly (the NGX case study)

The 6 accounts are fixed and NGX had no CSV export, so its trades were loaded straight into `transactions` (account `ngx`, currency `NGN`, tickers prefixed `NSENG:`). Two brokers:
- **Trove** — from an xlsx activity ledger + an "Innova" orders CSV.
- **Bamboo** — from phone screenshots of trade receipts (parsed by eye; no export existed).

Reusable lessons if you load more:
- **Tag provenance & a dedup key in `notes`.** Bamboo rows use `Bamboo <TICKER> <side> <qty>@<price> <DD/MM/YYYY HH:MM>` (the receipt's submit timestamp is unique); the insert skips any row whose exact `notes` key already exists, so re-sent/overlapping screenshots can't double-load. Trove rows use `Trove (old)…` / `Trove (Innova)…` tags. **More Bamboo data is expected** — dedup on this key when it arrives.
- **Exclude non-fills** (Expired/Failed, 0 filled qty) and duplicate captures.
- **MECURE is intentionally absent** (bought and fully sold on Bamboo; the winning sells weren't captured, and it nets to zero anyway). Don't "helpfully" add it.
- **Distinct instruments that look alike:** Bamboo `STANBIC` (Stanbic IBTC Holdings, ~₦110) ≠ Trove `STANBICETF30` (Stanbic ETF, ~₦2,364). Never merge.
- Buy `amount` = purchase value (exact from receipt), `commission` = est. commission; sell `amount` = qty×price. Bamboo's green/red "Trade adjustment" line is informational — ignore it for cost basis.

---

## 9. Gotchas & house rules

- **Everything derives from transactions.** Don't cache computed positions in a table.
- **NGX isolation** must be preserved across the five aggregate spots (§3) whenever you touch totals.
- **Yahoo `search()` needs `validateResult: false`** — its strict schema throws on some valid rows (e.g. `QDVE.DE`). See `tickers.ts`.
- **Recharts + hover:** memoise chart data so hover-only re-renders don't hand Recharts a new array reference (it replays the entry animation and flashes labels). See `AllocationPie.tsx` (`useMemo` on `pieData`).
- **Synchronous DB:** never `await` a query; better-sqlite3 is sync. Async only appears around network fetches (prices/FX).
- **Do NOT:** add auth, use an ORM, add dark mode/theming, over-abstract, or install unnecessary deps. Make reasonable decisions and finish the task rather than stopping to ask (per `CLAUDE.md`).
- **Colors:** green `#16a34a` positive, red `#dc2626` negative. Desktop-first.

---

## 10. Where to start for common tasks

- **New broker import:** add `src/lib/services/import/<broker>.ts`, register it in `import/index.ts`, normalise to `Transaction`. Test with a sample CSV.
- **New page/metric:** add a service function (derive from transactions), a thin `/api` route returning `{data}`, a component, and wire it into `layout/Nav.tsx`.
- **New ticker that won't price:** confirm routing in `prices.ts` (NGX vs Yahoo) and that `ticker_metadata.market` is right; NGX must be `NSENG:` and exist on TradingView.
- **Change aggregate totals:** edit `portfolio.ts` and remember `history.ts` + `benchmark.ts` mirror the NGX filter.
- **Verify a change end-to-end:** `npm run build`, run locally on a spare port, hit the relevant `/api/...`, and (for prod) compare live before/after numbers. There is a `verify` skill/flow for this.

---

## 11. Tests

`npm test` (Vitest). Coverage lives next to services (`*.test.ts`): MWR/IRR, FIFO holdings, CSV parsing, price routing, splits, rotation, theses, notes. Add tests for any new calc in the service layer.
