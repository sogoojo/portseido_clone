# Code Review Fix Plan

Full-codebase review findings (2026-06-10), ordered by priority. Each item: problem, location, fix approach.
Status: `[ ]` todo, `[x]` done.

## Critical — numbers shown are wrong

- [x] **C1. Period MWR omits starting portfolio value** — `src/lib/services/returns.ts:133-163`
  Sub-period IRR uses only in-period deposits/withdrawals + final value. A month with no deposits → 0%; a small deposit vs large final value → clamped +1000%.
  **Fix:** for each period, include portfolio value at period start as an initial negative cash flow (compute via historical replay or, simpler, value holdings at period-start prices). Periods predating the portfolio should return `null`, not 0.

- [x] **C2. "Historical returns" chart shows S&P 500, not portfolio** — `src/lib/services/returns.ts:256-272`
  `getHistoricalReturns` uses ^GSPC as a "proxy" for monthly/quarterly/annual portfolio returns.
  **Fix:** replay transactions to get portfolio value at each boundary (reuse history-route logic once C5/H-route is fixed), or clearly label the chart as benchmark until then.

- [x] **C3. Any cached row short-circuits historical price fetch** — `src/lib/services/prices.ts:241-243`
  `getHistoricalPrices` returns cache if *any* row exists in range; `getCurrentPrice` writes today's row to the same table, so 1Y requests return 1 row. Breaks history chart, benchmark returns, SPY counterfactual.
  **Fix:** check range coverage (earliest cached date within ~5 days of `from`, plus row-count sanity) before trusting cache; otherwise fetch from Yahoo and merge.

- [x] **C4. FX infinite recursion for pairs outside EUR/USD/NGN** — `src/lib/services/fx.ts:74-89` and `:140-144`
  `getRate('GBP','USD')`: pair not in FX_SYMBOLS → cross-rate fallback calls `getRate(from,'USD')` = itself, forever. Request hangs. Same in `getHistoricalRate` (no try/catch at all). Also unsupported pairs silently return rate=1.
  **Fix:** if `from === 'USD' || to === 'USD'` and pair unmapped, fetch `{from}{to}=X` (or `{to}{from}=X` inverted) directly from Yahoo instead of recursing; add a recursion guard; never silently return 1 (throw or return warning + null and let callers handle). Handle GBp (pence) → GBP/100.

- [x] **C5. Aggregate views sum EUR+USD+NGN raw** — multiple sites:
  - `src/app/api/portfolio/history/route.ts` (~160-200): `convert` imported, never called; holdings + deposits mix currencies. Also ignores `track_cash` (cash replay goes deeply negative for the 5 accounts with track_cash=0).
  - `src/lib/services/portfolio.ts`: `getTotalDeposited` (274-285), `getDailyPnL` (294-318), `getAllTimePnL` (330-414) — raw sums across account currencies for account=all.
  - `src/app/allocation/page.tsx:43-47`: cash summed across native currencies.
  - `src/components/allocation/HoldingsTable.tsx` + `AllocationPie.tsx`: hardcode `$`, ignore each holding's `currency` field; footer totals and pie slices mix currencies.
  **Fix:** convert to a single display currency (USD, matching `getAggregateValue`) in the service layer for account=all; in single-account views format with the account's actual currency symbol.

- [x] **C6. NGX/TradingView integration doesn't exist; stub fakes freshness** — `src/lib/services/prices.ts:120-132, 161-171`
  `@mathieuc/tradingview` not in package.json (CLAUDE.md says it's used). Stub returns latest cached row, then `getCurrentPrice` re-upserts it as *today's* close with `stale:false` — fabricates fresh data daily, pollutes history with flat fake bars.
  **Fix (minimum):** stop re-upserting cached price under today's date; return `stale:true` + warning. **Fix (full):** install @mathieuc/tradingview and implement NSENG quote fetch per CLAUDE.md.

## High — data corruption & broken flows

- [x] **H1. Watchlist re-add wipes target/tier/notes** — `src/lib/services/summaries.ts` (`addToWatchlist`, ~140-154) + `src/app/api/watchlist/route.ts:22-36`
  `ON CONFLICT DO UPDATE` sets target_entry/tier/notes to the route's null defaults. Only `name` is COALESCEd.
  **Fix:** `COALESCE(excluded.target_entry, watchlist.target_entry)` etc. for all three fields.

- [x] **H2. PUT /api/transactions has no validation** — `src/app/api/transactions/route.ts:118-137`
  No `type` whitelist check (POST has one), missing fields bind `undefined` → 500.
  **Fix:** validate like POST (shared helper); reject invalid type/missing required fields with 400. Optionally add CHECK constraint on transactions.type in schema for new DBs.

- [x] **H3. CSV import correctness** —
  - `src/lib/services/import/degiro.ts:111-136`: strip thousands separators before parseFloat (`"1,234.56"` → 1.23456 today); fee columns are EUR but stored under price currency; records with embedded newlines in quoted fields dropped/misparsed (split on `\n` before quote-aware parse).
  - `src/lib/services/import/index.ts:96-113`: `Math.abs` quantities (negative sells break FIFO); normalise dates to ISO YYYY-MM-DD (raw `03/15/2024` breaks all string date comparisons); drop `'time'` from date-column aliases.
  - `src/components/transactions/CsvImport.tsx:32-46, 85-105`: naive `split(',')` corrupts quoted fields (these rows get persisted for generic path); `parseFloat(...) || null` turns 0 into null — use Number.isFinite check.
  - `src/app/api/transactions/import/route.ts:55-80`: no dedupe on re-upload — capture Degiro Order ID (col 16) and/or dedupe on (account, date, ticker, type, quantity, amount) inside the existing db.transaction.

- [x] **H4. FIFO ignores commissions; cash balance mixes currencies** — `src/lib/services/portfolio.ts:21-66, 178-202`
  Commission excluded from cost basis and realised gains (gains overstated). `getCashBalance` subtracts trade-currency buy costs from account-currency deposits.
  **Fix:** add commission to buy lot cost and subtract from sell proceeds in computeFIFO (needs commission in the tx selects); in getCashBalance convert per-row when tx currency ≠ account currency (or document the approximation).

- [x] **H5. getAllTimePnL divides by 1 when all positions closed** — `src/lib/services/portfolio.ts:404`
  `totalCostBasis : 1` fallback → absurd % (e.g. +500,000%).
  **Fix:** return `total_pct: null` (or 0) when cost basis is 0; update UI to render "—".

- [x] **H6. db.ts startup resets user data; migrations swallow all errors** — `src/lib/db.ts:33, 61-63`
  `UPDATE accounts SET track_cash=0 ...` re-runs every boot (undoes user re-enable). Migration catch ignores every error, not just duplicate-column.
  **Fix:** make the UPDATE a one-time migration (guard via a schema_migrations table or a sentinel pragma/user_version); in catch, re-throw unless error message matches /duplicate column/.

- [x] **H7. Delayed cron silently produces empty day** — `src/lib/services/summaries.ts` (~375, 459-477) + cron route
  GitHub cron slip past 00:00 UTC → freshness guard skips all tickers → HTTP 200 with success:0, Action stays green, day missing.
  **Fix:** return non-2xx (or explicit failure flag the Action checks) when `success === 0 && total > 0`. Consider batching `yahooFinance.quote([...])` to stay under 120s maxDuration.

## Medium — UI correctness

- [x] **M1. Stale-response races in data fetching** — `src/app/page.tsx:23-30`, `allocation/page.tsx:28-35`, `performance/page.tsx:38-45`, `ValueChart.tsx:62-69`, `GainsReturnsPanel.tsx:27-37`, `CounterfactualCard.tsx:30-37`, `summaries/page.tsx:286-305`
  No abort/ignore of out-of-order responses; fast tab-switching renders wrong account's data. `if (json.data)` pattern keeps previous account's data on error.
  **Fix:** shared fetch hook with AbortController on dep change; clear data (or show error) on failure. Debounce the summaries ticker filter (M5 related).

- [x] **M2. Watchlist add/remove wedges on failure** — `src/app/watchlist/page.tsx:51-72`
  No try/finally, no res.ok check — button stuck on "Adding…" after one network blip.
  **Fix:** try/catch/finally around both; surface errors (see I3 toasts).

- [x] **M3. MWR vs benchmark apples-to-oranges; 0-sentinel ambiguity** — `BenchmarkTable.tsx:24`, `GainsReturnsPanel.tsx:62-76`, `returns.ts` (0 pushed on no-data)
  Annualised MWR shown next to non-annualised benchmark simple return; missing data encoded as 0 → rendered "—" in one place, green "+0.00%" in another.
  **Fix:** make both period (non-annualised) returns, or both annualised — pick one and label it; use `null` for no-data in service, render "—" consistently. (Coordinate with C1.)

- [x] **M4. Safari-invalid date parsing** — `src/app/summaries/page.tsx:311-327` (also pattern in `prices.ts:37`, `fx.ts:30`)
  `new Date("YYYY-MM-DD HH:MM:SSZ")` is non-ISO; Safari → Invalid Date.
  **Fix:** `.replace(' ', 'T')` before appending 'Z' (shared util).

- [x] **M5. SentimentTrends computes trends on truncated data** — `SentimentTrends.tsx:294` + `api/summaries` limit cap 200
  With ~35 tickers, 3M/1Y windows see only ~6 days of data, no indication.
  **Fix:** paginate or raise/parameterise the cap for the trends use; or aggregate server-side.

- [x] **M6. Counterfactual uses today's FX for historical deposits** — `src/lib/services/benchmark.ts:76`
  **Fix:** use `getHistoricalRate(ccy,'USD',cf.date)` per cash flow (depends on C4 fix for safety). Also handle weekend first-deposit: `findSpyPrice` only searches backwards but SPY history starts at firstDate — widen fetch start by ~7 days.

- [x] **M7. Smaller fixes** —
  - `TransactionForm.tsx:50-55`: currency doesn't follow account switch (drop the `!currency` guard).
  - `summaries.ts:197-204`: Brave `r.age` ("2 hours ago") stored as `published_at` timestamp — store null or parse relative age.
  - `api/transactions/route.ts:18-19` + `api/summaries/route.ts:11-12`: NaN from parseInt reaches `LIMIT ?` (binds NULL → unbounded) — guard with Number.isFinite.
  - `api/rebalance` POST: validate target_pct range and tier numeric.
  - `TransactionTable.tsx:84-91`: double-fetch race on filter change while page>1 — reset page and fetch in one effect.
  - `ValueChart.tsx:105-108`: UTC date label can show wrong month in negative offsets — format from string parts.
  - `degiro.ts:117-118`: zero-price corporate actions only skipped when |qty|<=1; flag unmapped ISINs in import response.

## Improvements — worth doing, not urgent

- [x] **I1. Batch Yahoo calls** — `prices.ts:296-298` (`getMultipleCurrentPrices` = N single quotes), `watchlist.ts:84-85` (~28 serial quotes), cron summaries (helps maxDuration). `yahooFinance.quote([...])` accepts arrays.
- [x] **I2. Hoist prepared statements out of loops** — `portfolio.ts:152` (metadata per holding), `targets.ts:75-76`, `summaries.ts:413-414`, `watchlist.ts:45-48`. Prepare once at module level like `upsertSummary`.
- [x] **I3. (done via inline error states instead of toasts — Toast system still unused) Wire up the dead Toast system** — ToastProvider mounted (`layout.tsx:35`) but `useToast` never called; every fetch uses `.catch(() => {})`. Surface fetch/API errors via toasts (fixes M2 UX, transactions delete, etc.). Also `InfoTabs.tsx:41-46`: empty array doubles as loading and error state → permanent "Loading benchmarks...".
- [x] **I4. Shared `/api/accounts` hook** — fetched independently in AccountSelector, BrokerTabs, TransactionForm, transactions page.
- [x] **I5. Export CSV exports only current 50-row page** — `TransactionTable.tsx:117-140` — fetch all filtered rows for export or label the file.
- [x] **I6. History route is O(points × transactions) with full FIFO per point** — sort once, advance index per date. Also `deposits_cumulative` ignores withdrawals.
- [x] **I7. GainsReturnsPanel refetches full /api/performance on every tab re-select** — `InfoTabs.tsx:74-77` conditional mount; cache or lift state.
- [x] **I8. (sortable headers, dialog semantics, remove-button label done; AllocationPie hover-only center detail remains) Accessibility** — sortable `<th onClick>` need button semantics/aria-sort; TransactionForm modal needs role="dialog", focus trap, Escape; AllocationPie center detail hover-only; watchlist remove button unlabeled.

## Verified non-issues (don't "fix")

- SQL injection: all dynamic SQL parameterised or whitelist-validated.
- Degiro buy/sell sign conventions and fee signs handled correctly.
- Seeds guarded to run only on empty tables, transactional.
- daily_summaries upsert idempotent (PK ticker,date) — cron retries safe.
- Counterfactual card's hardcoded `$` correct (service returns USD).
- Hydration clean; useSearchParams properly Suspense-wrapped.

## Suggested order of attack

1. C3 + C4 (price cache coverage, FX recursion) — foundations others depend on.
2. C1 + M3 (MWR with period-start value; consistent return display) — headline metric.
3. C5 (multi-currency aggregation, incl. history route + track_cash) — then C2 can reuse the fixed replay.
4. C6, H1, H2, H6 (NGX stub honesty, watchlist COALESCE, PUT validation, db.ts boot).
5. H3–H5, H7, then M*, then I*.
6. After each tranche: `npm test`, add Vitest coverage for MWR period flows, FIFO with commissions, FX cross-rates, CSV parsing edge cases. Deploy to Fly.io and verify on the live URL (per project convention).

## Status (2026-06-11)

All items above are done except:
- ~~C6 full fix~~ DONE (2026-06-11): live NGX feed implemented via @mathieuc/tradingview (`src/lib/services/tradingview.ts`) — anonymous websocket, daily candles, current quote with prev-close/day-change, historical backfill into price_cache, 15-min freshness on fetched_at, hard timeouts + cache fallback. Verified live (MTNN ₦800 +1.27%). NOTE: the NGX account has ZERO transactions (locally and deployed) — values stay ₦0 until the actual buys are entered.
- **M7 leftover**: import response does not yet flag unmapped Degiro ISINs.
- **I8 leftover**: AllocationPie center detail is still hover-only.

Notes on decisions made during the fixes:
- MWR (`returns.ts`) now returns CUMULATIVE period returns (fraction), null = no data. Directly comparable with benchmark `return_pct`. UI multiplies by 100.
- Historical returns use simple Dietz on the real portfolio (no more ^GSPC proxy).
- New shared service `src/lib/services/history.ts`: incremental FIFO replay + historical prices + historical FX→USD; external flows are deposits/withdrawals for track_cash accounts, buys/sells/dividends for the rest (5 of 6 accounts don't record deposits).
- All aggregate (account=all) money values are now USD at the service layer; single-account views are in the account currency. `AccountValue` gained `cash_usd`.
- `getCashBalance`/`getTotalDeposited` are now async (FX conversion).
- New `src/lib/hooks.ts`: `useApi` (abortable fetch + error state) and `useAccounts` (cached).
- CSV: shared `parseCsv`/`parseLocaleNumber`/`normaliseDate` in `import/index.ts`; client always sends raw CSV to the server parsers; import dedupes identical rows and reports `skipped`.
- db.ts: `_migrations` table for one-time data migrations; column migrations rethrow non-duplicate errors.
- New tests: `tests/services/import.test.ts`, `tests/services/fifo-commission.test.ts` (65 tests total, all green). `npm run build` passes.

## Deployed & verified live (2026-06-11)

Deployed to https://portseido-lite.fly.dev and smoke-tested against real data:
- `/api/fx?from=GBP&to=USD` → resolves instantly (previously hung forever)
- `/api/performance` → 1M MWR −3.3% vs S&P −1.8% (previously 0% or clamped +1000%); All-time +277% cumulative
- `/api/portfolio?account=all` → all holdings in USD, total_deposited $79.5k (USD-converted), all-time P&L +51.6%
- `/api/portfolio/history` → values in USD, S&P overlay renders (fixed a latent bug: monthly points snap to the 1st, before the SPY fetch range)
- `/api/watchlist` → 28 rows, seeded targets/tiers intact, batched quotes

Changes are NOT committed yet — working tree only.

## Added 2026-06-11: Nigerian watchlist

Separate "Nigeria (NGX)" section on the watchlist page with 18 seeded tickers
(DANGCEM, ZENITHBANK, ACCESSCORP, FCMB, MTNN, NESTLE, BETAGLAS, WAPCO, PRESCO,
OKOMUOIL, SEPLAT, UBA, BUAFOODS, AIICO, NEM, ARADEL, MECURE, BUACEMENT — all
validated against TradingView). Since NGX has no analyst coverage, signals are
candle-derived: 50/200-day MAs + 52-week range computed from TradingView daily
history (`ngxCandleStats` in watchlist.ts); fair entry = MA200 − 5%. Quotes are
batched over one websocket (`fetchTvDailyCandlesMulti`) with a 6h cache window
(NGX settles once per trading day). Seed is one-time via `_migrations`
('seed-ngx-watchlist') so user deletions stick. Verified live: 18 rows, ~1.6s
warm load.
