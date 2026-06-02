# Portseido Lite — Build Sequence

Each session below is a self-contained prompt for Claude Code.
Run with: `claude --dangerously-skip-permissions`
Paste the session prompt and walk away.

All decisions are pre-made. Do not ask clarifying questions — make reasonable choices and proceed.

---

## Session 1: Project Scaffold & Database

```
Read CLAUDE.md and docs/PLAN.md before starting.

Set up the Portseido Lite project from scratch:

1. Initialise Next.js 14+ with App Router, TypeScript, Tailwind CSS, ESLint:
   npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --use-npm --no-import-alias

2. Install dependencies:
   npm install better-sqlite3 yahoo-finance2 recharts
   npm install -D @types/better-sqlite3 vitest @testing-library/react

3. Create src/lib/schema.sql with the full schema from docs/PLAN.md (accounts, transactions, price_cache, fx_cache, ticker_metadata tables + indices).

4. Create src/lib/db.ts:
   - Uses better-sqlite3 to open ./data/portseido-lite.db
   - Creates the data/ directory if it doesn't exist
   - Reads schema.sql and runs it on first launch (use IF NOT EXISTS in DDL)
   - Exports a singleton db instance
   - Enable WAL mode for better concurrent read performance

5. Create src/lib/types.ts with all shared TypeScript types:
   - Account, Transaction, TransactionType ('buy'|'sell'|'deposit'|'withdrawal'|'dividend')
   - PriceData, FXRate, TickerMetadata
   - PortfolioHolding, PortfolioSummary
   - API response wrappers: ApiResponse<T> = { data: T } | { error: string, message: string }

6. Create a seed script (src/lib/seed.ts) that inserts the 6 accounts:
   - { id: 'degiro', name: 'Degiro', broker: 'degiro', currency: 'EUR' }
   - { id: 'trading212', name: 'Trading212', broker: 'trading212', currency: 'USD' }
   - { id: 'crypto', name: 'Crypto', broker: 'crypto', currency: 'USD' }
   - { id: 'morgan-stanley', name: 'Morgan Stanley', broker: 'morgan-stanley', currency: 'USD' }
   - { id: 'trader-republic', name: 'Trader Republic', broker: 'trader-republic', currency: 'EUR' }
   - { id: 'ngx', name: 'NGX Portfolio', broker: 'ngx', currency: 'NGN' }
   Run seed automatically in db.ts on first connection (if accounts table is empty).

7. Build the app layout shell (src/app/layout.tsx):
   - Left sidebar or top nav with tabs: Dashboard, Performance, Allocation, Transactions
   - Account selector dropdown (All + 6 accounts) that persists via URL search param ?account=all
   - Use Tailwind. Clean, professional look. Light mode. No dark mode.
   - Use a monospace or financial-style font for numbers (tabular-nums)

8. Create placeholder pages for each route:
   - src/app/page.tsx (Dashboard)
   - src/app/performance/page.tsx
   - src/app/allocation/page.tsx
   - src/app/transactions/page.tsx
   Each shows the page title and selected account.

9. Create src/app/api/accounts/route.ts:
   - GET: returns all accounts from DB

10. Verify the app runs: npm run dev should start on localhost:3000 with no errors, show the nav shell, and return accounts from the API.

Do not ask questions. Make reasonable decisions for any ambiguity. Complete everything.
```

---

## Session 2: Transactions CRUD & Table

```
Read CLAUDE.md and docs/PLAN.md before starting.

Build the full transactions system:

1. Create src/app/api/transactions/route.ts:
   - GET: list transactions with query params: account_id, ticker, type, date_from, date_to, page (default 1), limit (default 50). Return { data: transactions[], total: number, page: number, limit: number }
   - POST: create transaction. Validate required fields based on type (buy/sell need ticker, quantity, price_per_unit; deposit/withdrawal need amount). Return { data: transaction }
   - PUT: update transaction by id (passed in body). Return { data: transaction }
   - DELETE: delete transaction by id (passed as query param ?id=). Return { data: { deleted: true } }

2. Build src/components/transactions/TransactionTable.tsx:
   - Server-fetches from /api/transactions with current filters
   - Columns: Date, Action (coloured badge), Ticker, Price, Currency, Shares, Amount, Commission, Account
   - Sortable by clicking column headers (default: date descending)
   - Pagination controls at bottom
   - Filter bar: account dropdown (synced with global account selector), transaction type multi-select, date range picker, ticker search input
   - Empty state when no transactions

3. Build src/components/transactions/TransactionForm.tsx:
   - Modal dialog for add/edit
   - Fields adapt based on transaction type:
     - buy/sell: date, account, ticker (text input), quantity, price_per_unit, commission, currency, notes
     - deposit/withdrawal: date, account, amount, currency, notes
     - dividend: date, account, ticker, amount, currency, notes
   - Pre-populate account from global selector if not "all"
   - Validation: all required fields, quantity > 0, price > 0, valid date
   - On save: POST or PUT to API, refresh table

4. Add delete confirmation: clicking delete on a row shows a confirm dialog, then DELETEs.

5. Build src/components/transactions/CsvImport.tsx:
   - Upload button opens file picker (accept .csv)
   - User selects which account this CSV belongs to
   - On file select: parse CSV, show preview table of first 10 rows
   - "Import" button POSTs all parsed rows to /api/transactions/import

6. Create src/app/api/transactions/import/route.ts:
   - POST: accepts { account_id: string, transactions: Transaction[] }
   - Inserts all in a single SQLite transaction (BEGIN/COMMIT)
   - Returns { data: { imported: number } }

7. Create src/lib/services/import/index.ts:
   - Define ImportParser interface: { parse(csvContent: string): ParsedTransaction[] }
   - Create a parser registry: Map<broker, ImportParser>
   - Create a generic/fallback CSV parser that maps columns by header name (date, type/action, ticker/symbol, quantity/shares, price, amount, currency, commission/fee)
   - We will add broker-specific parsers later when we have sample CSVs

8. Wire up the Transactions page (src/app/transactions/page.tsx):
   - Shows TransactionTable with CsvImport and "Add Transaction" button above
   - Clicking add opens TransactionForm in create mode
   - Clicking edit icon on a row opens TransactionForm in edit mode

Do not ask questions. Complete everything. Make the UI clean and functional.
```

---

## Session 3: Price & FX Services

```
Read CLAUDE.md and docs/PLAN.md before starting.

Build the price data layer:

1. Create src/lib/services/prices.ts (PriceService):
   - getCurrentPrice(ticker: string): fetches current price
   - getHistoricalPrices(ticker: string, from: Date, to: Date): fetches OHLCV history
   - Routes based on ticker:
     - If ticker starts with "NSENG:" or ticker_metadata.market === 'ngx' → use TradingView
     - Everything else → use Yahoo Finance via yahoo-finance2
   - Yahoo Finance: use yahoo-finance2's quote() for current, historical() for history
   - TradingView: use @mathieuc/tradingview to connect via WebSocket, fetch NSENG:{ticker} price. If the TradingView package doesn't work easily or has connection issues, fall back to a simpler approach: scrape from afx.kwayisi.org/ngx/{ticker}.html or just cache NGX prices manually and skip auto-fetch for now. Do NOT block the build on this — use a stub that returns cached/manual prices if needed.
   - Cache all fetched prices in price_cache table
   - On read: check if cached price exists and is < 15 min old; if yes return cached; if no fetch fresh

2. Create src/lib/services/fx.ts (FXService):
   - getRate(from: string, to: string): returns conversion rate
   - Supported pairs: EURUSD, USDEUR, NGNUSD, NGNEUR (derive inverses)
   - Source: Yahoo Finance (EURUSD=X, NGNUSD=X)
   - Cache in fx_cache table with same 15-min staleness
   - convert(amount: number, from: string, to: string): convenience method

3. Create ticker metadata fetcher in PriceService:
   - When a ticker is first encountered (not in ticker_metadata table):
     - Yahoo Finance: fetch quoteSummary to get name, sector, industry, currency
     - NGX tickers: insert with market='ngx', asset_type='ngx_equity', sector can be null (we'll add manually later)
   - Cache in ticker_metadata table

4. Create API routes:
   - src/app/api/prices/route.ts: GET ?tickers=AAPL,MSFT,NSENG:MTNN → returns current prices for all
   - src/app/api/fx/route.ts: GET ?from=EUR&to=USD → returns rate

5. Handle errors gracefully:
   - If Yahoo Finance is down or rate-limited: return last cached price regardless of staleness, add a "stale" flag
   - If a ticker doesn't exist: return null with a warning, don't crash
   - Log all fetch errors to console

6. Write basic tests in tests/services/prices.test.ts:
   - Test cache logic (mock db)
   - Test ticker routing logic (ngx vs yahoo)

Do not ask questions. If @mathieuc/tradingview gives trouble, implement a stub and move on. Complete everything.
```

---

## Session 4: Portfolio Calculations

```
Read CLAUDE.md and docs/PLAN.md before starting.

Build the portfolio calculation engine:

1. Create src/lib/services/portfolio.ts (PortfolioService):

   a. getHoldings(accountId?: string): 
      - Query all buy/sell transactions, grouped by ticker (and account if specified)
      - Apply FIFO to compute: current_quantity, avg_cost, cost_basis for each ticker
      - Fetch current price for each ticker via PriceService
      - Compute: market_value, unrealised_gain, unrealised_gain_pct, 1d_change, 1d_change_pct
      - Return array of PortfolioHolding objects

   b. getPortfolioValue(accountId?: string):
      - Sum market_value across all holdings
      - Add cash balance (deposits - withdrawals - purchase costs + sale proceeds)
      - Return in account's native currency

   c. getAggregateValue():
      - For each account: get portfolio value in native currency
      - Convert all to EUR using FXService → total_eur
      - Convert all to USD using FXService → total_usd
      - Return { total_eur, total_usd, accounts: [...per-account values] }

   d. getDailyPnL(accountId?: string):
      - today's change = current_value - yesterday_close_value
      - yesterday's change = yesterday_close - day_before_close
      - Return { today: { amount, pct }, yesterday: { amount, pct } }

   e. getCashBalance(accountId: string):
      - Sum all deposits - sum all withdrawals
      - Subtract total cost of buys (quantity × price + commission)
      - Add total proceeds of sells (quantity × price - commission)
      - Return remaining cash

2. Create src/app/api/portfolio/route.ts:
   - GET ?account=all → getAggregateValue()
   - GET ?account=degiro → getPortfolioValue('degiro') + getHoldings('degiro') + getDailyPnL('degiro')

3. FIFO implementation details:
   - Process transactions for each (account, ticker) pair in date order
   - Maintain a queue of lots: [{date, remaining_qty, price}]
   - On buy: push new lot
   - On sell: consume from front of queue (oldest first), reduce remaining_qty
   - Handle partial lot consumption correctly
   - If sell quantity exceeds available lots: log warning, don't crash

4. Write tests in tests/services/portfolio.test.ts:
   - Test FIFO with simple buy/sell
   - Test FIFO with multiple lots and partial sells
   - Test FIFO with sell exceeding holdings (edge case)
   - Test cash balance calculation
   - Use an in-memory SQLite db for tests

```

---

## Session 5: Dashboard Page

```
Read CLAUDE.md and docs/PLAN.md before starting.

Build the dashboard:

1. Create src/components/dashboard/PortfolioSummary.tsx:
   - Large total value display (EUR + USD on aggregate, native currency on per-account)
   - Today's P&L: amount + percentage, green or red
   - Yesterday's P&L: amount + percentage
   - All-time gain: amount + percentage
   - Use large, clear typography. Numbers in tabular-nums font.

2. Create src/components/dashboard/CounterfactualCard.tsx:
   - Create src/lib/services/benchmark.ts (BenchmarkService):
     - calculateCounterfactual(accountId?: string): 
       - Get all deposit transactions (and withdrawals) with dates
       - For each deposit: look up SPY closing price on that date (use PriceService historical)
       - Calculate hypothetical SPY shares bought/sold
       - Multiply total hypothetical shares by current SPY price
       - Return { counterfactual_value, your_value, difference, difference_pct }
   - Display: "What if investing in S&P 500" card showing counterfactual value, all-time return %, comparison

3. Create src/components/dashboard/AccountCards.tsx:
   - Horizontal scrollable row of cards, one per account
   - Each card: account name, current value, today's change %, all-time change %
   - Clicking a card switches the account selector to that account

4. Create src/components/dashboard/ValueChart.tsx:
   - Recharts AreaChart showing portfolio value over time
   - Overlay: S&P 500 line normalised to same starting point (so both start at 100%)
   - Light grey area for cash deposits cumulative line
   - Time range buttons: 1M, 3M, 6M, YTD, 1Y, 3Y, 5Y, All
   - Tooltip showing date, portfolio value, S&P value on hover
   - X axis: dates, Y axis: value
   - Implementation for historical value:
     - Create /api/portfolio/history route
     - For All time range: compute monthly data points (not daily) to keep it fast
     - For 1M/3M: compute daily data points
     - Each data point: replay transactions up to that date, multiply holdings by closing prices
     - Cache computed snapshots in a new portfolio_snapshots table if it's slow
     - If computing is too slow for V1, use monthly-only granularity for all ranges

5. Wire up src/app/page.tsx (Dashboard):
   - Read ?account= from URL search params
   - If account=all or not set: show aggregate view with all components
   - If account=degiro etc: show per-account view
   - Fetch data from /api/portfolio and /api/portfolio/history
   - Show loading skeletons while fetching
   - Benchmark cards at bottom: S&P 500 and NASDAQ current values (fetch from /api/prices)

6. Create src/components/ui/LoadingSkeleton.tsx:
   - Pulsing grey placeholder matching card/chart dimensions

 If historical value computation is complex, implement the simplest working version first (even if monthly granularity only). Complete everything.
```

---

## Session 6: Performance Page

```
Read CLAUDE.md and docs/PLAN.md before starting.

Build the performance page:

1. Create src/lib/services/returns.ts (ReturnService):

   a. calculateMWR(cashFlows: {date: Date, amount: number}[], finalValue: number, finalDate: Date): number
      - Implement Newton-Raphson IRR solver
      - Cash flows: deposits are negative, withdrawals are positive, final value is positive
      - Max 100 iterations, tolerance 1e-10
      - Initial guess: 0.1 (10%)
      - Return annualised rate: (1 + r)^(365/days) - 1
      - Handle edge cases: no cash flows returns 0, single cash flow, all same date

   b. getPortfolioReturns(accountId?: string): 
      - Calculate MWR for periods: 1M, 3M, 6M, YTD, 1Y, 2Y, 5Y, All
      - For each period: filter transactions to that window, get portfolio value at start and end
      - Return { period: string, mwr: number }[]

   c. getBenchmarkReturns(symbol: string, periods: string[]): 
      - For each period: get index price at start and end, calculate simple return
      - S&P 500: ^GSPC, NASDAQ: ^IXIC
      - Return { period: string, return: number }[]

   d. getHistoricalReturns(accountId?: string, granularity: 'monthly'|'quarterly'|'annually'):
      - For each period bucket: calculate portfolio return
      - Return { period: string, return: number }[]

2. Create src/app/api/performance/route.ts:
   - GET ?account=all&periods=1M,3M,6M,YTD,1Y,All
   - Returns { portfolio: returns[], benchmarks: { sp500: returns[], nasdaq: returns[] }, historical: returns[] }

3. Create src/components/performance/BenchmarkTable.tsx:
   - Table with rows: Portfolio, S&P 500, NASDAQ
   - Columns: 1M, 3M, 6M, YTD, 1Y, 2Y, 5Y, All, Annualized
   - Each cell: percentage formatted to 2 decimal places
   - Green text for positive, red for negative, bold red for worst in column
   - Handle missing data (account too new for 5Y): show "-"

4. Create src/components/performance/HistoricalReturnChart.tsx:
   - Recharts BarChart
   - Green bars for positive return months, red for negative
   - Toggle: Monthly | Quarterly | Annually
   - X axis: period labels, Y axis: percentage

5. Wire up src/app/performance/page.tsx:
   - Benchmark comparison table at top
   - Historical return chart below
   - Loading states
   - Respects account selector

6. Write tests in tests/services/returns.test.ts:
   - Test IRR calculation with known cash flows and expected result
   - Test with single deposit + final value
   - Test with multiple deposits and withdrawals
   - Test edge case: zero return, negative return

 Complete everything.
```

---

## Session 7: Allocation Page

```
Read CLAUDE.md and docs/PLAN.md before starting.

Build the allocation page:

1. Create src/components/allocation/AllocationPie.tsx:
   - Recharts PieChart with labels showing ticker/sector and percentage
   - Two modes: "By Holding" and "By Sector" (tab toggle)
   - Four view options: Market Value (default), Cost, Gain, Loss
   - Colours: use a predefined palette of 12+ distinct colours, consistent per ticker
   - Centre label: total value
   - Responsive: reasonable size on desktop

2. Create src/components/allocation/HoldingsTable.tsx:
   - Columns: Ticker, Name, Sector, Allocation %, Last Price, Avg Cost, 1D Gain %, Unrealised Gain %, Unrealised Gain (abs), Market Value, Shares
   - Click column header to sort (asc/desc toggle)
   - Colour code: 1D Gain and Unrealised Gain green/red
   - Format: prices to 2 decimal places, percentages to 2 decimal places, shares to appropriate precision
   - Cash row at top showing cash balance and 0% allocation
   - Footer row showing totals

3. Wire up src/app/allocation/page.tsx:
   - Fetch from /api/portfolio?account={selected}
   - Top section: pie charts side by side (by holding, by sector)
   - Bottom section: holdings table
   - Loading skeletons

4. Ensure sector data works:
   - For US/EU tickers: sector comes from ticker_metadata (fetched from Yahoo Finance)
   - For NGX tickers: sector may be null — show as "Nigerian Equities" or fetch manually
   - For crypto: show as "Cryptocurrency"
   - For unknown: show as "Other"

Complete everything.
```

---

## Session 8: Polish, Error Handling & Export

```
Read CLAUDE.md and docs/PLAN.md before starting.

Polish and harden the application:

1. Error handling:
   - Wrap all API routes in try/catch, return { error, message } with appropriate HTTP status
   - PriceService: if Yahoo Finance fails, return last cached price with { stale: true } flag
   - Show toast notifications on the frontend for errors (create a simple Toast component)
   - If no transactions exist: show helpful empty states on all pages

2. Loading states:
   - Every page and component that fetches data shows a skeleton loader
   - Charts show a shimmer placeholder at chart dimensions
   - Tables show row skeletons

3. Empty states:
   - Dashboard with no data: "No transactions yet. Import your broker CSV or add transactions manually." with a link to /transactions
   - Performance with no data: "Need at least 1 month of data to show returns."
   - Allocation with no data: "No holdings found."

4. CSV export:
   - Add "Export CSV" button on transactions page
   - Downloads all visible/filtered transactions 
   as CSV
   - Filename: portseido-lite-transactions-{date}.csv

5. Cross-page verification:
   - Test account selector works on every page (switching accounts updates data)
   - Test navigation between all pages
   - Verify no console errors

6. Performance check:
   - If historical chart is slow (>3 seconds): add a portfolio_snapshots table and cache daily values
   - Add console.time/timeEnd to expensive calculations for monitoring

7. Create a README.md:
   - Project name and description
   - Setup: npm install, npm run dev
   - Data: stored in ./data/portseido-lite.db
   - How to import data: go to /transactions, click Import CSV
   - Architecture overview (brief)

8. Verify everything works end-to-end:
   - Start the app: npm run dev
   - Confirm all pages render
   - Confirm API routes respond
   - Run tests: npm test

Do not ask questions. Complete everything.
```

---

## How to Run Each Session

```bash
cd portseido-lite

# Start Claude Code in autonomous mode
claude --dangerously-skip-permissions

# Then paste the session prompt and let it run
```

Wait for each session to complete before starting the next one. Sessions build on each other sequentially.

If a session fails partway through, you can re-run it — Claude Code will pick up where it left off since the files already exist.
