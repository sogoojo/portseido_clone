# Portseido Lite

Personal portfolio tracker — lightweight Portseido replacement. Single user, no auth.

## Tech Stack
- Next.js 14+ (App Router) with TypeScript (strict mode)
- SQLite via better-sqlite3 (local-first, file at ./data/portseido-lite.db)
- Tailwind CSS for styling (light mode only)
- Recharts for all charts (line, area, bar, pie)
- yahoo-finance2 for US/EU equity prices, crypto (BTC-USD, ETH-USD), FX (EURUSD=X, NGNEUR=X), benchmarks (^GSPC, ^IXIC)
- @mathieuc/tradingview for NGX (Nigerian) stock prices (NSENG:MTNN, NSENG:ZENITHBANK, etc.) — anonymous websocket, daily candles, no API key; see `src/lib/services/tradingview.ts`

## Architecture
- All data derives from the `transactions` table — it is the single source of truth
- Service layer in `src/lib/services/` handles all business logic
- API routes in `src/app/api/` are thin wrappers around services
- SQLite is accessed synchronously via better-sqlite3 — no async DB calls
- Price/FX data cached in SQLite with 15-minute staleness window
- Price service routes to Yahoo Finance (US/EU/crypto/FX) or TradingView (NGX) based on ticker; NGX freshness keys off fetched_at since candles are dated by trading day
- Historical valuation (history chart, period MWR, historical returns) goes through `src/lib/services/history.ts` — FIFO replay + historical prices + historical FX to USD

## Key Patterns
- **FIFO cost basis** for holdings calculation
- **MWR (Money-Weighted Return)** via Newton-Raphson IRR as primary return metric
- **Multi-currency**: accounts are EUR, USD, or NGN; aggregate views show EUR and USD totals using live FX
- **Broker CSV import**: each broker has a parser in `src/lib/services/import/` — parsers normalise to a common Transaction type
- **S&P 500 counterfactual**: uses actual deposit dates + SPY historical prices to compute "what if" value

## 6 Accounts
1. Degiro (EUR) — EU equities
2. Trading212 (USD) — US equities
3. Crypto (USD) — BTC, ETH
4. Morgan Stanley (USD) — US equities
5. Trader Republic (EUR) — EU equities
6. NGX Portfolio (NGN) — Nigerian stocks (MTNN, ZENITHBANK, GTCO, SEPLAT, OKOMUOIL, etc.)

## Code Conventions
- Shared types in `src/lib/types.ts`
- Components are functional with hooks
- No ORMs — raw SQL with better-sqlite3 prepared statements
- API routes return `{ data }` on success, `{ error, message }` on failure
- All money values stored as REAL (float)
- Green (#16a34a) for positive returns, red (#dc2626) for negative
- Desktop-first design; must remain fully usable on phones (see doc/specs/mobile-responsive.md)
- Account selector persists across views via URL search param `?account=all`

## File Organisation
- Pages: `src/app/(dashboard|performance|allocation|transactions)/page.tsx`
- API routes: `src/app/api/...`
- Services: `src/lib/services/`
- Components: `src/components/` grouped by feature
- DB: `src/lib/db.ts` (connection + auto-migration), `src/lib/schema.sql`

## External APIs
- yahoo-finance2: no API key needed
- @mathieuc/tradingview: no API key needed (WebSocket to TradingView)
- Benchmarks: ^GSPC (S&P 500), ^IXIC (NASDAQ)

## Testing
- Vitest for unit tests on service layer
- Focus: MWR/IRR calculation, FIFO holdings, CSV parsing, price routing
- Run: `npm test`

## Do NOT
- Add authentication or user management
- Use an ORM (keep raw SQL)
- Over-abstract — this is a personal tool, not a SaaS
- Add dark mode or theme switching
- Install unnecessary dependencies
- Ask the user clarifying questions — make reasonable decisions and proceed
- Stop and wait for confirmation — complete the full task
