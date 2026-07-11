# Spec: NGX broker mini-pies (Trove vs Bamboo)

**Status:** ready for implementation · **Reviewer:** the maintainer's primary agent will review the PR
**Read first:** `ARCHITECTURE.md` (especially §1 transactions-as-source-of-truth, §3 service layer, §9 gotchas), then this spec.

## 1. Goal

On the Allocation page, when the **NGX Portfolio** account is selected (`?account=ngx`), show a "By Broker" section: **two compact donut charts side by side — "Trove" and "Bamboo"** — each showing that broker's holdings within the NGX account, with the broker's total NGN value in the centre.

The NGX account is one app account (`account_id='ngx'`, currency NGN) that physically spans two Nigerian brokers. Broker provenance is recorded **only in the `notes` column** of each transaction (see §3). This feature surfaces that split visually.

### Non-goals

- No changes to any aggregate (`all`) view, the EUR/USD totals, or the NGX isolation logic (`ISOLATED_CURRENCY` in `src/lib/services/portfolio.ts`). This feature is strictly additive to the NGX single-account view.
- No schema change. Broker is derived from `notes` at query time — do **not** add a broker column.
- No FX. Everything in this feature is native NGN.
- No changes to other accounts' views (the section renders only for `ngx`).

## 2. Current data facts (verified 2026-07-11, production)

- All 165 `ngx` transactions carry a notes tag: `Trove (old) …`, `Trove (Innova) …`, or `Bamboo …`.
- Open positions split cleanly today: Trove holds MTNN, ZENITHBANK, GTCO, OKOMUOIL, NESTLE, PRESCO, BUAFOODS, STANBICETF30, MERGROWTH (~₦11.4M); Bamboo holds NEM, WAPCO, DANGCEM, ARADEL, BETAGLAS, SEPLAT, NGXGROUP (~₦10.4M).
- **No ticker currently overlaps brokers with an open position** — but the algorithm must not rely on that (per-broker FIFO below handles overlap naturally). Note: BETAGLAS exists in *both* brokers' history — bought AND fully sold on Trove (net 0), later bought on Bamboo (open). This is a mandatory test case.
- Bamboo STANBIC is a fully-closed round-trip (net 0) → must not appear in any pie.

## 3. Broker derivation rule

Bucket each `ngx` buy/sell row by `notes` prefix:

| `notes` starts with | Bucket |
|---|---|
| `Trove ` (covers `Trove (old)` and `Trove (Innova)`) | `Trove` |
| `Bamboo ` | `Bamboo` |
| anything else (incl. NULL — e.g. a trade typed manually in the UI) | `Other` |

`Other` exists so nothing is silently dropped. It renders as a third mini-pie **only when non-empty** (it is empty today).

## 4. Service layer

Add to **`src/lib/services/portfolio.ts`** (it reuses that module's exported `computeFIFO`, its `tickerMetaStmt`, and follows its style — raw SQL, prepared statements, no ORM):

```ts
export interface NgxBrokerBreakdown {
  broker: string;                 // 'Trove' | 'Bamboo' | 'Other'
  holdings: PortfolioHolding[];   // same shape the allocation page already consumes
  total_value: number;            // NGN, sum of holdings market_value
}

export async function getNgxBrokerHoldings(): Promise<NgxBrokerBreakdown[]>
```

Algorithm:

1. `SELECT date, type, ticker, quantity, price_per_unit, commission, notes FROM transactions WHERE account_id='ngx' AND type IN ('buy','sell') AND ticker IS NOT NULL ORDER BY date, id`.
2. Bucket rows per §3, then group by `(broker, ticker)` and run `computeFIFO` per group. Drop groups with `quantity <= 0.0001` (sold out).
3. Collect the unique tickers across all buckets and price them with **one** `getMultipleCurrentPrices(tickers)` call (never per-ticker calls in a loop — see ARCHITECTURE.md §9 / audit finding #18).
4. Build `PortfolioHolding` rows: `market_value = qty × price`, `unrealised_gain = market_value − cost_basis`, `currency: 'NGN'`, name/sector from `tickerMetaStmt`. `allocation_pct` is the holding's share **within its broker**. A null price ⇒ set `current_price`/`market_value` to `0` *and* keep the row (consistent with current app behavior; do not invent a new convention here).
5. Return buckets ordered `Trove, Bamboo, Other`, omitting empty ones.

Dividends/deposits/withdrawals are irrelevant (no quantity effect) — filtered out by the `type IN ('buy','sell')` predicate.

## 5. API

New thin route **`src/app/api/portfolio/ngx-brokers/route.ts`**:

- `GET` → `{ data: NgxBrokerBreakdown[] }` on success, `{ error, message }` + appropriate status on failure (house convention).
- No query params. No auth (single-user app).
- Keep it thin: parse nothing, call `getNgxBrokerHoldings()`, wrap response.

(Alternative considered and rejected: piggybacking on `/api/portfolio?account=ngx` — keeps that payload lean and this feature independently cacheable/fetchable.)

## 6. UI

### 6.1 `AllocationPie` compact mode

`src/components/allocation/AllocationPie.tsx` currently hardcodes geometry (`CHART_HEIGHT 475`, `INNER_RADIUS 93`, `OUTER_RADIUS 131`, label-ring constants). The Portseido-style leader-line labels **do not fit at mini size** — do not try to shrink them.

Add an optional `compact?: boolean` prop that:

- renders at ~`260px` height with proportionally smaller radii (`inner ≈ 52`, `outer ≈ 78`);
- **disables the outer slice labels entirely** (`label={undefined}`) — hover tooltip + centre label carry the information;
- keeps the centre overlay (total when idle, hovered slice name/value/% on hover) — this is the primary readout at this size;
- hides the `Market Value / Cost / Gain / Loss` toggle row and the group-mode toggle (compact pies are market-value, by-holding only);
- keeps the existing `useMemo` on `pieData` (do not regress the hover-flash fix — ARCHITECTURE.md §9).

Everything else (colors, tooltip, hover dimming) stays shared so the minis visually match the big donuts.

### 6.2 Allocation page wiring

In `src/app/allocation/page.tsx`, when `account === 'ngx'`:

- fetch `useApi<{ data: NgxBrokerBreakdown[] }>('/api/portfolio/ngx-brokers')`;
- below the existing two donuts, render a `<h3>`-titled section **"By Broker"** with a responsive 2-col grid (3-col if `Other` is present; stacks on small screens) of compact `AllocationPie`s — `title` = broker name, `holdings` = bucket holdings, `cashBalance={0}`, `currency="NGN"`;
- under each pie, one line: `₦<total_value formatted> · <n> holdings` (reuse the compact money formatting already in `AllocationPie`/`formatMoney` style — ₦ symbol is already supported);
- loading state: reuse `ChartSkeleton`; error state: reuse the existing red error-panel style of the page; if the endpoint returns an empty array, render nothing (no empty section).

For every other account value (including `all`), this section must not render **and the endpoint must not be fetched** (pass `null` to `useApi` — it supports conditional URLs).

## 7. Edge cases (all must be handled; most are test cases)

1. **BETAGLAS**: net 0 on Trove, open on Bamboo → appears only in the Bamboo pie.
2. **STANBIC (Bamboo)**: fully closed → appears nowhere.
3. **Future cross-broker overlap** (same ticker open in both): each broker shows its own qty/cost slice; combined they equal the account-level holding. Unit-test with synthetic data.
4. **Untagged row** → `Other` bucket appears as a third pie; unit-test.
5. **Sell without a matching buy in the same bucket** (shouldn't exist, but): `computeFIFO` already tolerates it; the bucket simply shows the net; no crash.
6. **Null price** (TradingView miss): row kept at 0 value — same convention as the rest of the app today. Do not exclude it silently.
7. **MERGROWTH-style tiny positions**: no minimum-size filtering; the pie's existing `LABEL_MIN_PCT` logic is irrelevant in compact mode (labels off).

## 8. Tests (Vitest, colocated: `src/lib/services/portfolio-ngx-brokers.test.ts` — follow the existing colocated `*.test.ts` convention, NOT a `tests/` dir)

In-memory SQLite fixture (see `splits.test.ts` for the pattern):

1. Bucketing: `Trove (old)`/`Trove (Innova)` merge into `Trove`; `Bamboo` separate; untagged → `Other`.
2. Per-broker FIFO: buys/sells within a broker net correctly; sold-out group omitted.
3. Cross-broker same ticker: Trove net-0 + Bamboo open → only Bamboo bucket contains it (the BETAGLAS case).
4. Ordering + omission: result ordered Trove, Bamboo, Other; empty buckets absent.
5. `allocation_pct` sums to ~100 within each bucket.

Mock/stub the price call (the service should take prices via the existing `getMultipleCurrentPrices` — in tests, either stub the module or seed `price_cache` and point the db at the fixture; choose whichever existing tests do).

## 9. Acceptance criteria

- [ ] `npm test` passes, including the new suite; `npx tsc --noEmit` clean; `npm run build` passes.
- [ ] `/allocation?account=ngx` shows the existing two big donuts **plus** a "By Broker" row: Trove (9 holdings, ~₦11.4M) and Bamboo (7 holdings, ~₦10.4M) — totals must equal the NGX account's holdings value when summed (verify against `/api/portfolio?account=ngx` `value` minus cash).
- [ ] Hovering a mini-pie slice shows name/value/% in the centre; no label flicker (hover-flash regression check).
- [ ] `/allocation?account=all` and every non-ngx account render exactly as before; `/api/portfolio/ngx-brokers` is not fetched there.
- [ ] Aggregate totals (`/api/portfolio?account=all`) are byte-identical before/after (this feature reads, never writes; NGX isolation untouched).
- [ ] No new dependencies. No schema changes. Raw SQL prepared statements only.

## 10. House rules & process

- Follow `CLAUDE.md`: no auth, no ORM, no dark mode, no over-abstraction, don't stop for confirmation.
- Branch + PR against `main` (like PR #1); the PR description must state what was verified (tests, build, manual check of `/allocation?account=ngx` with the real dev DB). The reviewer will run the acceptance checklist above.
- Note: the local dev DB does **not** contain the NGX rows (production-only). For manual verification, either seed a few tagged `ngx` buys locally, or pull a prod DB copy (`fly ssh sftp get /app/data/portseido-lite.db ./data/portseido-lite.db` — back up the local file first). Tests must not depend on either.
