# Portseido Lite

Personal portfolio tracker — a lightweight, local-first alternative to Portseido Pro. Single user, no auth. Tracks multiple brokerage accounts across currencies (EUR, USD, NGN) with FIFO cost basis, money-weighted returns (IRR), an S&P 500 counterfactual, sector rotation radar, AI-free analyst/fundamental signals, a rules-based rebalancer, and a discipline layer (per-holding theses + pre-committed sell triggers).

> **Working on the code?** Read [`ARCHITECTURE.md`](./ARCHITECTURE.md) — it's the deep-dive written for a developer (or agent) picking the project up.

## Quick start

```bash
npm install
npm run dev            # http://localhost:3000
npm test               # vitest unit tests
npm run audit:integrity # read-only transaction/data audit
npm run build && npm start   # production build
```

No setup, no API keys, no external database. On first run the SQLite file `./data/portseido-lite.db` is created from `src/lib/schema.sql` and seeded with 6 accounts, a watchlist, and rebalance targets.

## Accounts

| Account | Broker | Currency | Holds |
|---------|--------|----------|-------|
| Degiro | Degiro | EUR | EU/US equities |
| Trading212 | Trading212 | USD | US equities |
| Crypto | Crypto | USD | BTC-USD, ETH-USD |
| Morgan Stanley | Morgan Stanley | USD | US equities |
| Trader Republic | Trader Republic | EUR | EU/US equities |
| NGX Portfolio | NGX | NGN | Nigerian stocks (`NSENG:` tickers) |

**NGX is tracked in isolation** — its naira value is deliberately kept out of the aggregate EUR/USD totals (see `ISOLATED_CURRENCY` in `src/lib/services/portfolio.ts`). It's fully viewable on its own via the account selector (`?account=ngx`).

## Features

- **Dashboard** (`/`) — total value (EUR + USD), value-over-time chart, day / all-time P&L, gains & returns, per-account cards, S&P 500 counterfactual.
- **Performance** (`/performance`) — period MWR (money-weighted return), historical return chart, benchmark table (S&P 500, NASDAQ).
- **Allocation** (`/allocation`) — By-holding and by-sector donut charts, holdings table.
- **Transactions** (`/transactions`) — add/edit trades, live ticker symbol search (Yahoo), CSV import per broker.
- **Watchlist** (`/watchlist`) — tiered watchlist with target-entry buy signals + action items/reminders.
- **Rebalance** (`/rebalance`) — compares live weights to per-ticker targets and suggests buys/sells.
- **Radar** (`/radar`) — sector-rotation heatmap.
- **Summaries** (`/summaries`) — end-of-day price/momentum + free analyst/fundamental signals (US/EU via Yahoo) and Nigerian-press news + TradingView fundamentals (NGX); per-holding theses & sell triggers.

## Data sources (all free, no keys)

- **yahoo-finance2** — US/EU equity prices, crypto (`BTC-USD`), FX (`EURUSD=X`, `NGNUSD=X`, `NGNEUR=X`), benchmarks (`^GSPC`, `^IXIC`), analyst/fundamental signals, live ticker search, split events.
- **@mathieuc/tradingview** — NGX daily candles (anonymous websocket) + NGX valuation fundamentals (scanner endpoint). Yahoo has no NGX coverage.
- **Nairametrics / BusinessDay RSS** — Nigerian-press headlines for the NGX summaries (Yahoo has no NGX news).
- **Telegram** (optional) — pushes for due reminders and price-triggered alerts.

Prices/FX are cached in SQLite with a 15-minute staleness window (2h for NGX, which prints rarely).

## Read-only integrity audit

Run `npm run audit:integrity` to inspect the local database without modifying it or making network calls. The command opens SQLite in read-only/query-only mode and reports invalid rows, amount mismatches, chronological oversells, exact-economic reconciliation candidates (with the full same-day trade sequence), and mixed-currency positions with cached-close/FX magnitude evidence.

Use `npm run audit:integrity -- --json` for a reviewable JSON report, or `--db /path/to/copy.db` to audit a database copy. Exact-economic matches are candidates, not confirmed duplicates; reconcile them against the broker statement before changing transactions. Price evidence uses only existing cache data, and historical FX is often unavailable, so a raw-close match alone is not proof that a transaction's currency label is wrong.

## Importing data

**CSV:** go to `/transactions` → **Import CSV** → pick the broker → upload. Parsers live in `src/lib/services/import/` and normalise each broker's format to the common `Transaction` shape.

**Manual / scripted:** all data is just rows in the `transactions` table — the single source of truth. Everything else (holdings, returns, allocation) is derived. See `ARCHITECTURE.md` → "Loading data directly" for the pattern used to load the NGX (Trove/Bamboo) trades.

## Tech stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript** (strict)
- **better-sqlite3** — synchronous, local-first SQLite (no ORM, raw SQL)
- **Tailwind CSS v4** — light mode only
- **Recharts v3** — all charts
- **Vitest** — unit tests on the service layer

## Deployment

Runs on **Fly.io** (`portseido-lite`, Amsterdam) from the `Dockerfile` (Next.js standalone output). The SQLite DB lives on a persistent Fly volume mounted at `/app/data`.

```bash
fly deploy      # manual; builds the Dockerfile and ships it
```

There is no auto-deploy pipeline. Two GitHub Actions workflows only *ping* the running app on a schedule:
- `daily-summaries.yml` → `POST /api/cron/daily-summaries` (evening, UTC)
- `reminders.yml` → `POST /api/cron/reminders` (hourly)

Both are guarded by a `CRON_SECRET` header. See `ARCHITECTURE.md` → "Deployment & operations".

## Conventions

- API routes return `{ data }` on success, `{ error, message }` on failure.
- Money stored as `REAL`. Green `#16a34a` positive, red `#dc2626` negative.
- Account selection persists across views via the `?account=` URL param.
- Do **not** add auth, an ORM, dark mode, or over-abstraction — this is a personal tool. See `CLAUDE.md` for the full house rules.
