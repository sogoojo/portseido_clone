# Spec: Mobile-friendly Portseido Lite (Android & iPhone browsers + add-to-home-screen)

**Status:** ready for implementation · **Reviewer:** the maintainer's primary agent will review the PR
**Read first:** `ARCHITECTURE.md`, then this spec. Prior art for the process: `doc/specs/ngx-broker-minipies.md` → PR #2.

## 1. Goal

Make the existing Next.js web app fully usable on phones (Android Chrome, iPhone Safari), and pleasant when saved to the home screen — **as a responsive web app / basic PWA, not native apps**. Desktop rendering at `lg` and above must remain pixel-identical.

### Non-goals

- No native iOS/Android apps, no React Native, no Capacitor.
- No service worker / offline mode (portfolio data must always be live; a stale cached total is worse than a spinner). No push notifications (Telegram already covers alerts).
- No dark mode (house rule), no new dependencies, no design refresh — same visual language, smaller screens.
- No service-layer or API changes. This is a UI/layout PR only.

## 2. Current state (surveyed 2026-07-12 — verify before starting)

Already mobile-tolerant, **do not rework**:
- All wide tables/heatmaps sit in `overflow-x-auto` wrappers (`HoldingsTable`, `TransactionTable`, `BenchmarkTable`, `RotationHeatmap`, `AccountCards`, `CsvImport`).
- Page grids use `grid-cols-1 lg:grid-cols-*` responsive classes; `main` has `min-w-0`.
- `BrokerTabs` horizontally scrolls (`overflow-x-auto`).
- Charts use Recharts `ResponsiveContainer`.

The blockers this spec fixes:

| # | Blocker | Where |
|---|---|---|
| B1 | Fixed 208px sidebar always visible (`<aside className="w-52 shrink-0 … min-h-screen">`) — consumes half a phone screen | `src/components/layout/Nav.tsx` + `src/app/layout.tsx` |
| B2 | Transaction modal is a centred `max-w-lg p-6` card with no height constraint — the long form overflows small viewports (worse with the keyboard up) | `src/components/transactions/TransactionForm.tsx:156-161` |
| B3 | Full-size `AllocationPie` geometry (475px chart, label ring 155 + text) clips labels horizontally below ~500px container width | `src/components/allocation/AllocationPie.tsx` |
| B4 | No PWA metadata: no manifest, no icons (public/ has only Next starter SVGs), no theme color, viewport left to Next's default | `src/app/layout.tsx`, `src/app/` file conventions |
| B5 | Small polish: `PageHeader` title + account selector on one unwrappable row; `main` padding `px-6` generous on phones | `src/components/layout/PageHeader.tsx`, `src/app/layout.tsx` |

## 3. B1 — Navigation

Breakpoint: **`lg`** (1024px). At `lg+` everything stays exactly as today (sidebar visible, no top bar).

Below `lg`:
- Hide the sidebar. Show a **sticky top bar** (`sticky top-0 z-40`, white, bottom border): brand "Portseido Lite" left, hamburger button right (min 44×44px touch target, `aria-label="Open navigation"`, `aria-expanded`).
- Hamburger opens a **slide-over drawer** from the left (~w-64, full height, `z-50`, dark backdrop `bg-black/40`): the *same* 8 nav links as the sidebar — one source of truth. Refactor the link list into a shared component/array rather than duplicating; both the sidebar and the drawer render it.
- Drawer closes on: backdrop tap, close (×) button, **route change** (navigate → close), and Escape.
- While open, lock body scroll (`overflow-hidden` on `body` or the scroll container; restore on close).
- Plain React state + Tailwind only — no headlessui/radix (no new deps).
- Implementation shape: `Nav` becomes a client component that renders `<aside className="hidden lg:block …">` plus the `lg:hidden` top bar + drawer; `layout.tsx`'s flex row needs `flex-col lg:flex-row` (or equivalent) so the top bar sits above `main` on phones.

## 4. B2 — Transaction modal

Keep the desktop presentation. Below `sm` (or via plain always-on classes that don't change desktop): 
- Container: `w-full max-w-lg` stays, but add `max-h-[90dvh] overflow-y-auto` and side margins (`mx-4`) so it never touches screen edges and long forms scroll *inside* the card. Use `dvh` (not `vh`) so the iOS keyboard/URL bar don't clip the footer buttons.
- Align to `items-end sm:items-center` on the overlay flex so on phones it reads as a bottom sheet (`rounded-t-lg sm:rounded-lg`) — cheap, no animation required.
- Inputs must not trigger iOS auto-zoom: any input the user types in needs an effective font-size ≥16px on mobile (`text-base sm:text-sm` on the form inputs, incl. `TickerCombobox`'s input).
- Check the same constraints on any other modal/dialog found (`grep -rn "fixed inset-0" src/components` — apply the same treatment).

## 5. B3 — AllocationPie on narrow screens

The component already has a parameterized geometry system (`PieGeometry`, `FULL_GEOM`, `COMPACT_GEOM`) and stable label renderers (`makeRenderLabel`). Extend, don't rewrite:

- Add `MOBILE_GEOM` ≈ `{ height: 360, inner: 68, outer: 98, ring: 120, minPct: 0.8, spacing: 13, font: 9.5 }` (tune as needed).
- Select it when the pie is **not** `compact` and the viewport is narrow: a small `useIsNarrow()` hook using `window.matchMedia('(max-width: 640px)')` with `useSyncExternalStore` (SSR-safe: return `false` on the server; the value only affects client rendering after hydration).
- Compact (broker mini-pies) already fits phones — leave as-is.
- Preserve BOTH regressions we've fixed before: the `useMemo` on `pieData` (hover-flash — include the geometry/narrow flag in its deps) and the default-visible slice labels. Add a stable `renderLabelMobile = makeRenderLabel(MOBILE_GEOM)` — do not create label functions inline per render.
- Acceptance: at 390px viewport, `/allocation?account=degiro` (11 slices) and `?account=ngx` show every label un-clipped, no horizontal page scroll.

## 6. B4 — PWA metadata & icons (no binary assets, no deps)

Use Next.js first-party file conventions only:

- `src/app/manifest.ts` (`MetadataRoute.Manifest`): name "Portseido Lite", short_name "Portseido", `start_url: '/'`, `display: 'standalone'`, `background_color: '#f9fafb'`, `theme_color: '#16a34a'`, icons referencing the generated icon routes below.
- `src/app/icon.tsx` and `src/app/apple-icon.tsx` via `ImageResponse` from `next/og` (bundled with Next — not a new dep): a simple mark, e.g. white "P" on the house green `#16a34a`, sizes 512 (icon) and 180 (apple-icon). This gives Android maskable-ish icons and the iOS home-screen icon without committing PNGs.
- In `layout.tsx`: `export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#16a34a' }`. Optionally `metadata.appleWebApp = { capable: true, title: 'Portseido', statusBarStyle: 'default' }`.
- Verify `GET /manifest.webmanifest`, `/icon`, `/apple-icon` return 200 in the production build.

## 7. B5 — Polish

- `PageHeader`: `flex-col gap-2 sm:flex-row sm:items-center sm:justify-between` so the account selector wraps below the title on phones (selector full-width there is fine).
- `main` padding: `px-4 py-4 lg:px-6 lg:py-6`.
- Sweep for accidental horizontal overflow at 360px: every page in the nav must not scroll the *body* horizontally (inner `overflow-x-auto` containers are the sanctioned mechanism). Fix offenders with the existing wrapper pattern only.
- Touch targets: interactive controls users tap routinely (nav links, tabs, hamburger, modal buttons, form buttons) ≥ 40px effective height on mobile. The tiny pie view-mode toggles may stay as-is.

## 8. Out of scope / guardrails

- Do not touch: `src/lib/services/**`, API routes, DB, NGX isolation, the pie label layout engine's algorithm (only add geometry), CSV import logic.
- Do not add dependencies or a service worker. Do not introduce `useEffect`-based window-size listeners where `matchMedia` + `useSyncExternalStore` suffices.
- Desktop (`lg+`) must be visually unchanged — the reviewer will diff screenshots at 1440px.

## 9. Verification & acceptance criteria

- [ ] `npx tsc --noEmit`, `npm test` (all existing tests pass — no service changes), `npm run build` all clean.
- [ ] At **390×844** (iPhone 14/15) and **360×800** (small Android), with browser devtools emulation: every nav page renders with **no horizontal body scroll**; sidebar hidden; top bar + drawer work (open, navigate, auto-close, Escape, scroll lock).
- [ ] Transaction form opens, all fields reachable and submittable at 390×844; typing in inputs does not zoom the page on iOS (font-size ≥16px verified in computed styles).
- [ ] `/allocation?account=ngx` at 390px: both big donuts and the two broker mini-pies render with all labels visible and un-clipped.
- [ ] `manifest.webmanifest`, `icon`, `apple-icon` return 200 in `npm run build && npm start`; Lighthouse (mobile) "installable" check passes or the only failures are HTTPS-related (local).
- [ ] At **1440px**: dashboard, allocation, transactions visually identical to `main` (reviewer compares).
- [ ] PR description reports what was actually verified, and honestly flags anything not verifiable in the sandbox (e.g. real-device Safari) — the reviewer will test on real devices.

## 10. Process

- Branch off `main`, one PR, like PR #1/#2. Update the `CLAUDE.md` line "Desktop-first, responsive as secondary concern" to "Desktop-first design; must remain fully usable on phones (see doc/specs/mobile-responsive.md)".
- The local dev DB has no NGX rows; for the NGX pie checks either seed a few tagged `ngx` buys locally or pull a prod copy per `ARCHITECTURE.md` §7 (back up the local file first; **checkpoint the WAL before copying** — see PR #1 review note).
- Keep commits scoped (nav shell / modal / pie / PWA / polish) — it makes the review diff-by-diff.
