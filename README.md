# Portseido Lite

Personal portfolio tracker — a lightweight, local-first alternative to Portseido Pro. Tracks multiple brokerage accounts across currencies (EUR, USD, NGN) with FIFO cost basis, money-weighted returns (IRR), and S&P 500 counterfactual comparison.

## Setup

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Data

All data is stored locally in `./data/portseido-lite.db` (SQLite). No external database required.

The database is created automatically on first run with 6 pre-configured accounts:

| Account | Broker | Currency |
|---------|--------|----------|
| Degiro | Degiro | EUR |
| Trading212 | Trading212 | USD |
| Crypto | Crypto | USD |
| Morgan Stanley | Morgan Stanley | USD |
| Trader Republic | Trader Republic | EUR |
| NGX Portfolio | NGX | NGN |

## Importing Data

1. Go to `/transactions`
2. Click **Import CSV**
3. Select your broker and upload the CSV file
4. Transactions are parsed and imported automatically

Supported brokers have parsers in `src/lib/services/import/`.

## Architecture

- **Next.js 14+** (App Router) with TypeScript
- **SQLite** via better-sqlite3 — synchronous, local-first
- **Tailwind CSS** — light mode only
- **Recharts** — all charts (line, area, bar, pie)
- **yahoo-finance2** — US/EU equity prices, crypto, FX, benchmarks
- **@mathieuc/tradingview** — NGX (Nigerian) stock prices (stubbed)

### Key Concepts

- **Single source of truth**: all data derives from the `transactions` table
- **FIFO cost basis**: oldest lots sold first
- **MWR/IRR**: money-weighted return via Newton-Raphson solver
- **Multi-currency**: accounts in EUR/USD/NGN, aggregate views in both EUR and USD
- **S&P 500 counterfactual**: "what if you'd invested in SPY instead?"
- **15-minute price cache**: prices cached in SQLite, stale after 15 min

### File Structure

```
src/
  app/              # Pages and API routes
    api/            # REST API (thin wrappers around services)
    (pages)/        # Dashboard, Performance, Allocation, Transactions
  components/       # React components grouped by feature
  lib/
    services/       # Business logic (portfolio, prices, FX, returns, import)
    db.ts           # SQLite connection + migration
    types.ts        # Shared TypeScript types
    schema.sql      # Database schema
tests/
  services/         # Vitest unit tests
```

## Testing

```bash
npm test
```

Tests cover MWR/IRR calculation, FIFO holdings, and price service routing.
