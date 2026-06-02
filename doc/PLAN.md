# Portseido Lite — Plan & Requirements

## 1. Product Overview

Personal portfolio tracker consolidating holdings across 6 brokerage accounts into a single dashboard. Replaces Portseido Pro. Single user, no auth, local-first.

---

## 2. Functional Requirements

### 2.1 Accounts & Multi-Currency

| # | Account | Currency | Broker Type | Market |
|---|---------|----------|-------------|--------|
| 1 | Degiro | EUR | degiro | EU equities |
| 2 | Trading212 | USD | trading212 | US equities |
| 3 | Crypto | USD | crypto | BTC, ETH |
| 4 | Morgan Stanley | USD | morgan-stanley | US equities |
| 5 | Trader Republic | EUR | trader-republic | EU equities |
| 6 | NGX Portfolio | NGN | ngx | Nigerian equities |

- Aggregate dashboard shows total portfolio value in **both EUR and USD**
- NGN positions converted via NGNEUR or NGNUSD FX rates
- FX source: Yahoo Finance (EURUSD=X, NGNEUR=X / NGNUSD=X)

### 2.2 Transactions (source of truth)

Every holding, return, and allocation metric derives from the transaction ledger.

**Transaction types:**
- **Buy** — date, ticker, quantity, price_per_unit, currency, commission, account
- **Sell** — same fields
- **Deposit** — date, amount, currency, account (cash inflow for MWR + counterfactual)
- **Withdrawal** — date, amount, currency, account
- **Dividend** — date, ticker, amount, currency, account (optional V1)

**Data entry:**
- CSV import with broker-specific parsers (format varies per broker — built iteratively)
- Manual entry via UI form as fallback
- Edit and delete individual transactions
- Search and filter by date, ticker, action, account

### 2.3 Dashboard (Home)

**Aggregate view (All Portfolios):**
- Total portfolio value in EUR and USD
- Today's change (absolute + %)
- Yesterday's change (absolute + %)
- All-time gain (absolute + %)
- Portfolio value line chart over time with S&P 500 overlay and cash deposits
- Time range selector: 1M, 3M, 6M, YTD, 1Y, 3Y, 5Y, All
- Account summary cards (name, value, today %, all-time %)

**Per-account view:**
- Same metrics scoped to one account
- Same chart with S&P 500 overlay
- Benchmark index cards (S&P 500 + NASDAQ current values + daily change)

**S&P 500 Counterfactual ("What if investing in S&P 500"):**
- Uses actual deposit dates and amounts
- Calculates what portfolio value would be if each deposit bought SPY
- Shown on dashboard: counterfactual value, today's change, all-time return

### 2.4 Performance

**Benchmark comparison table:**
- Rows: Portfolio, S&P 500, NASDAQ
- Columns: 1M, 3M, 6M, YTD, 1Y, 2Y, 5Y, All, Annualized
- Primary return metric: MWR (Money-Weighted Return / IRR)
- Colour-coded green/red

**Historical return bar chart:**
- Monthly/Quarterly/Annually toggleable
- Green bars positive, red bars negative

### 2.5 Allocation

**Pie charts:**
- By holding (ticker) — market value weighted
- By sector — from ticker metadata
- Toggleable: Market Value, Cost, Gain, Loss views

**Holdings table:**
- Columns: Ticker, Name, Sector, Allocation %, Last Price, Avg Cost, 1D Gain %, Unrealised Gain %, Unrealised Gain (abs), Market Value, Shares
- Sortable columns
- Filterable by account or aggregate

### 2.6 Price Data

**Two-source price router:**
- **Yahoo Finance** (yahoo-finance2): US/EU equities, ETFs, crypto (BTC-USD, ETH-USD), FX rates, benchmark indices
- **TradingView** (@mathieuc/tradingview): NGX stocks (NSENG:MTNN, NSENG:ZENITHBANK, etc.)

**Routing logic:**
- If ticker metadata has `market = 'ngx'` → TradingView
- Everything else → Yahoo Finance

**Cache strategy:**
- All prices cached in SQLite `price_cache` table
- 15-minute staleness window for current prices
- Historical prices cached permanently
- Sector/metadata from Yahoo Finance quote summary (ngx metadata may need manual seeding)

### 2.7 UI / UX

- Light mode only
- Clean, data-dense financial dashboard aesthetic
- Recharts for all charts
- Desktop-first, responsive secondary
- Tab navigation: Dashboard | Performance | Allocation | Transactions
- Account selector (All + 6 accounts) persistent across views via URL param

---

## 3. Data Model (SQLite)

```sql
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  broker TEXT NOT NULL,
  currency TEXT NOT NULL,        -- 'EUR', 'USD', or 'NGN'
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  date DATE NOT NULL,
  type TEXT NOT NULL,            -- 'buy', 'sell', 'deposit', 'withdrawal', 'dividend'
  ticker TEXT,                   -- NULL for deposit/withdrawal
  quantity REAL,                 -- NULL for deposit/withdrawal
  price_per_unit REAL,          -- NULL for deposit/withdrawal
  amount REAL,                  -- total amount
  currency TEXT NOT NULL,
  commission REAL DEFAULT 0,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE price_cache (
  ticker TEXT NOT NULL,
  date DATE NOT NULL,
  open REAL,
  high REAL,
  low REAL,
  close REAL NOT NULL,
  currency TEXT NOT NULL,
  fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (ticker, date)
);

CREATE TABLE fx_cache (
  pair TEXT NOT NULL,            -- 'EURUSD', 'NGNUSD', 'NGNEUR'
  date DATE NOT NULL,
  rate REAL NOT NULL,
  fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (pair, date)
);

CREATE TABLE ticker_metadata (
  ticker TEXT PRIMARY KEY,
  name TEXT,
  sector TEXT,
  industry TEXT,
  asset_type TEXT,              -- 'equity', 'crypto', 'etf', 'ngx_equity'
  market TEXT,                  -- 'us', 'eu', 'ngx', 'crypto'
  currency TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_transactions_account ON transactions(account_id);
CREATE INDEX idx_transactions_date ON transactions(date);
CREATE INDEX idx_transactions_ticker ON transactions(ticker);
CREATE INDEX idx_price_cache_ticker ON price_cache(ticker);
```

---

## 4. Architecture

```
┌─────────────────────────────────────────────┐
│                Next.js App                   │
│                                              │
│  Pages: Dashboard | Performance |            │
│         Allocation | Transactions            │
│                    │                         │
│  ┌─────────────────┴──────────────────────┐  │
│  │          React Components              │  │
│  │  (Charts, Tables, Cards, Forms)        │  │
│  └─────────────────┬──────────────────────┘  │
│                    │                         │
│  ┌─────────────────┴──────────────────────┐  │
│  │        Next.js API Routes              │  │
│  │  /api/transactions  (CRUD + import)    │  │
│  │  /api/accounts      (CRUD)            │  │
│  │  /api/prices        (fetch + cache)    │  │
│  │  /api/portfolio     (computed metrics) │  │
│  │  /api/performance   (returns, MWR)     │  │
│  │  /api/fx            (exchange rates)   │  │
│  └─────────────────┬──────────────────────┘  │
│                    │                         │
│  ┌─────────────────┴──────────────────────┐  │
│  │          Service Layer                 │  │
│  │  PortfolioService  (holdings, values)  │  │
│  │  ReturnService     (MWR/IRR calc)      │  │
│  │  PriceService      (Yahoo + TV router) │  │
│  │  FXService         (rates + convert)   │  │
│  │  ImportService     (CSV parsers)       │  │
│  │  BenchmarkService  (counterfactual)    │  │
│  └─────────────────┬──────────────────────┘  │
│                    │                         │
│  ┌─────────────────┴──────────────────────┐  │
│  │        SQLite (better-sqlite3)         │  │
│  │        ./data/portseido-lite.db        │  │
│  └────────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
         │                    │
         ▼                    ▼
   Yahoo Finance        TradingView WS
   (US/EU/crypto/FX)    (NGX stocks)
```

---

## 5. Key Algorithms

### 5.1 Money-Weighted Return (MWR / IRR)

```
Given cash flows: CF_0, CF_1, ..., CF_n at times t_0, t_1, ..., t_n
Find rate r such that:
  Σ CF_i / (1 + r)^((t_i - t_0) / 365) = 0

Where:
  - Deposits are negative cash flows (money in)
  - Withdrawals are positive cash flows (money out)
  - Final portfolio value is a positive cash flow at t_n

Solve using Newton-Raphson iteration (max 100 iterations, tolerance 1e-10).
Annualize: (1 + r)^(365/days) - 1
```

### 5.2 S&P 500 Counterfactual

```
For each deposit D_i at date d_i (converted to USD):
  spy_price_i = SPY closing price on d_i
  shares_bought_i = D_i / spy_price_i

For each withdrawal W_j at date d_j (converted to USD):
  spy_price_j = SPY closing price on d_j
  shares_sold_j = W_j / spy_price_j

counterfactual_shares = Σ shares_bought - Σ shares_sold
counterfactual_value = counterfactual_shares × current_SPY_price
```

### 5.3 Holdings Derivation (FIFO)

```
For each ticker in account:
  lots = [] (ordered by date)
  For each Buy: append {date, quantity, price} to lots
  For each Sell: consume from oldest lot first (FIFO)
  
  current_quantity = Σ remaining lot quantities
  avg_cost = Σ (lot_qty × lot_price) / current_quantity
  cost_basis = avg_cost × current_quantity
  market_value = current_quantity × current_price
  unrealised_gain = market_value - cost_basis
```

### 5.4 Portfolio Value Over Time

```
For each day d from first_transaction_date to today:
  For each account:
    For each holding as of d (replay transactions up to d):
      value += quantity × closing_price(ticker, d)
    value += cash_balance as of d
  Convert to base currency using FX rate on d
  
Optimisation: cache daily snapshots, only recompute from last snapshot
```

---

## 6. File Structure

```
portseido-lite/
├── CLAUDE.md
├── docs/
│   ├── PLAN.md              (this file)
│   └── BUILD_SEQUENCE.md    (session prompts)
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── next.config.js
├── vitest.config.ts
│
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx              (Dashboard)
│   │   ├── performance/page.tsx
│   │   ├── allocation/page.tsx
│   │   ├── transactions/page.tsx
│   │   └── api/
│   │       ├── accounts/route.ts
│   │       ├── transactions/
│   │       │   ├── route.ts
│   │       │   └── import/route.ts
│   │       ├── prices/route.ts
│   │       ├── fx/route.ts
│   │       ├── portfolio/route.ts
│   │       └── performance/route.ts
│   │
│   ├── lib/
│   │   ├── db.ts
│   │   ├── schema.sql
│   │   ├── types.ts
│   │   └── services/
│   │       ├── portfolio.ts
│   │       ├── returns.ts
│   │       ├── prices.ts
│   │       ├── fx.ts
│   │       ├── benchmark.ts
│   │       └── import/
│   │           ├── index.ts
│   │           ├── degiro.ts
│   │           ├── trading212.ts
│   │           ├── trader-republic.ts
│   │           ├── morgan-stanley.ts
│   │           ├── crypto.ts
│   │           └── ngx.ts
│   │
│   └── components/
│       ├── layout/
│       │   ├── Nav.tsx
│       │   ├── AccountSelector.tsx
│       │   └── PageHeader.tsx
│       ├── dashboard/
│       │   ├── PortfolioSummary.tsx
│       │   ├── ValueChart.tsx
│       │   ├── AccountCards.tsx
│       │   └── CounterfactualCard.tsx
│       ├── performance/
│       │   ├── BenchmarkTable.tsx
│       │   └── HistoricalReturnChart.tsx
│       ├── allocation/
│       │   ├── AllocationPie.tsx
│       │   └── HoldingsTable.tsx
│       ├── transactions/
│       │   ├── TransactionTable.tsx
│       │   ├── TransactionForm.tsx
│       │   └── CsvImport.tsx
│       └── ui/
│           ├── Card.tsx
│           ├── Table.tsx
│           ├── Badge.tsx
│           ├── Tabs.tsx
│           └── LoadingSkeleton.tsx
│
├── data/
│   └── .gitkeep              (db created at runtime)
│
└── tests/
    ├── services/
    │   ├── portfolio.test.ts
    │   ├── returns.test.ts
    │   └── prices.test.ts
    └── setup.ts
```
