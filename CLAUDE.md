# notion-worker-forecast

A [Notion Workers](https://developers.notion.com) worker that builds BlueLabel's
monthly revenue forecast. It reads Deal Revenue Schedules from Notion, computes
prorated and probability-weighted revenue, rewrites three views in a Google
Sheet, and publishes a theme-aware HTML dashboard back into a Notion page.

This is **not** the dppt worker. If dppt context appears in a session, ignore it.

## Brand rule

Always write **"BlueLabel"** — never "Blue Label", "Blue Label Labs", or "BLL".
This applies to code, comments, commit messages, and anything rendered.

## ⚠️ README.md is out of date

`README.md` describes the original fork's design: a single tidy "Forecast Facts"
fact table for pivot tables. That is **historical**. The worker now renders three
formatted Sheet tabs and a stacked Notion embed. Trust this file and the source
over the README.

## Data sources

Notion, queried via `notion.dataSources.query({ data_source_id })`. IDs live in
`src/lib/notionForecast.ts`.

| Source | ID | Role |
| --- | --- | --- |
| Deal Revenue Schedules | `37bf6504-1608-4bf0-af10-c6e5123cc618` | **Source of truth for $.** weeklyRevenue or fixed fee, date window, client account, stage probability |
| Deals | `ee89a6dd-be27-4bc5-bc5f-86b6ef40be2b` | Pipeline records. Open deals with no schedule read as $0 placeholders (`readOpenPlaceholderDeals`) |
| Revenue Targets | `3d24ed00-8078-809a-9a06-000be9fdbb2d` | One row per quarter. `Name` = "YYYY.Q#". **Source of truth for targets** |
| Deal Stage Changes | `d893ad12-e8c9-4ce5-8aec-677b09c1c025` | Stage transitions. Timestamps are bulk-imported and **unreliable** — see below |

- **Google Sheet** "Forecast Dashboard": `11B2nldq0THoy_NYhBa7ZAFeb8YWKwn2l_0Rtd0toGyY`.
  Worker-written tabs: Client Partner, Pipeline (sheetId `385847462`), Weighted
  Monthly, append-only Snapshots, hidden `_forecast_lock`. Auth via the worker's
  `googleAuth` OAuth capability.
- **Notion "Experimental Reporting" page**: `3d24ed00807880f0aa20f33754e60b61`.
  Holds the embed. Auth via `NOTION_API_TOKEN` (the BlueLabel DPPT integration,
  which is connected to that page).

## Business rules

**Sales stages.** Probability is the nominal CRM win-rate, **not** historically
calibrated — weighted values are a benchmark, not a hard forecast. Definitions
live in `STAGE_DEFS` in `src/lib/render.ts` and render into column B of the
Pipeline cascade.

- 100% Contract signed / Won
- 80% Verbally agreed, price and start date accepted / Closing
- 60% Proposal with pricing **and** a client champion / Negotiating
- 40% Discussing scope and timeframe / Estimating
- 20% Qualified discussion of objectives and scope / Qualifying
- 10% New Opportunity
- 0% Lost / Unqualified — excluded from Client Partner and Pipeline tabs

**Revenue math.** Each schedule accrues `weeklyRevenue` per week, or a fixed fee
when `weeklyRevenue` is 0. Prorated to months by **calendar days**
(`weeklyRevenue × days ÷ 7`). Weighted = monthly $ × stage probability.

> Proration (time) and the win-rate haircut (probability) are **independent** and
> each applied exactly once. Do not double-count them.

Forecast clamps to roughly 2026-01…2028-12 (`MIN_MONTH`/`MAX_MONTH` in
`src/lib/forecast.ts`). The gap simulator deliberately uses an **unclamped**
spread so pre-2026 client arcs render fully.

**Existing vs net-new.** Open pipeline: net-new = account with 0 won deals,
existing = 1 or more. Committed: new-logo = exactly 1 won deal, expansion = more
than 1. "Continuation" was renamed **"Expansion Forecast"** in the plan chart.

**Targets.** The Revenue Targets DB is authoritative — never hardcode. Current
ramp is roughly $1.2M (2026.Q1) to a ~$2.69M/quarter plateau by ~2027.Q3.

**New-logo detection (gap simulator).** Groups won deals into per-account revenue
arcs, excluding accounts whose earliest deal BL number is below 360
(`NEW_LOGO_BL_FLOOR`). BL numbers are sequential deal IDs, so they work as a
chronological proxy for re-imported old clients. Yields ~16 arc templates.

**Snapshots.** Append-only weekly history, one row per deal per week, keyed to
that week's Monday in America/New_York. A Google Apps Script trigger fires
Tuesday ~4 PM ET.

## Sheet views

`renderForecastViews` rewrites Client Partner, Pipeline, and Weighted Monthly
from live schedules. Code in `src/lib/render.ts`, entry point
`src/webhooks/renderForecastViews.ts`. Tabs are addressed by stable `sheetId`,
so renaming them in the Sheet is safe.

**These tabs are worker-generated and overwritten on every render.** The workflow
is: hand-edit the layout in the Sheet, then replicate that edit in `render.ts`.
Do not assume a Sheet edit will survive.

Pipeline Stats is 8 rows (QoQ Target Growth, QoQ Actual Growth, Closed, Weighted
Value, Target, Weighted Gap, Coverage %, Closed %). Header and merges span rows
1–11; deals start at row 12. `TARGET_ROW=6`, `WV_ROW=5`. The empty 0% cascade
tier is suppressed.

## Notion embed

One draggable embed, `forecast_vs_plan.html`, stacking three reports in order:
Forecast vs Plan (KPI cards + glidepath + windowed bars) → Coverage Funnel →
Gap Simulator. Webhook `renderNotionFunnel`; libs `notionEmbed.ts`,
`embedStack.ts`, `planHtml.ts`, `funnelHtml.ts` + `coverageFunnel.ts`,
`simulatorHtml.ts` + `simulator.ts`.

**Why one document rather than nested iframes** (hard-won, do not re-litigate):
Notion's embed sandbox strips nested `<iframe srcdoc>` and renders blank, and
`eval`/`new Function` is risky. So each report is authored independently and
merged by `renderStackedEmbed`: CSS scoped per section under a wrapper class
(`.s0`/`.s1`/`.s2`, with `:root`/`body` rewritten to the wrapper), a plain inline
`<script>` per section, the `[hidden]{display:none!important}` reset restored,
`BRAND_FONTS` hoisted once, a theme-aware background on the outer document, and
shared-id collisions disambiguated (`#tt` per section; the funnel's `foot` becomes
`ffoot`).

Embeds live in per-report synced-block containers, matched by filename in the
signed S3 URL (`syncReportEmbeds`), so a refresh swaps the embed inside its
container and manual placement survives.

Notion API v2026-03-11 constraints: embed PATCH rejects `embed.file_upload` and
positional `after`; embeds expose only caption and url with **no settable
height**; uploads are immutable.

**Coverage-funnel model.** Per near-quarter window, open pipeline by stage 10–80%
against a per-stage "ideal minimum". Three models via toggle, **Distributed is
the default**: Single-stage (ideal = gap ÷ win-rate), Distributed (gap ÷ Σ
win-rates, flat per stage), Actual (no ideal; light = gross, fill = weighted).
Gap = target − Won. The 0% tier is dropped. Each stage splits existing (solid)
vs net-new (diagonal stripe).

## Visual system

Applies to any report, sheet, or HTML artifact produced here.

- Fonts via CSS vars: `--font:"NB International Pro"`, `--book:"NB Book"`,
  `--mono:"NB Mono"`, each with a real `"Helvetica Neue",Arial,sans-serif`
  fallback. `BRAND_FONTS` (base64 NB faces) is in `src/lib/brandFonts.ts`.
- Accent blue `#2424FC` (dark mode `#8A8AFF`), teal `#0D9488`, slate greys.
- Pipeline stage colors are Google Sheets "light 3" 3-step ramps
  (light track / mid stripe / deep solid): 0–10% magenta
  `#EAD1DC`/`#C27BA0`/`#A64D79`; 20–40% purple `#D9D2E9`/`#8E7CC3`/`#674EA7`;
  60% blue `#CFE2F3`/`#6FA8DC`/`#3D85C6`; 80–100% green
  `#D8EAD3`/`#93C47D`/`#6AA84F`.
- **Always theme-aware.** Full light palette on bare `:root`; dark overrides in
  *both* `@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){…}}`
  and `:root[data-theme="dark"]{…}`. Always set an explicit token background,
  never transparent.
- Money: millions to one decimal ($3.5M, $4.0M); thousands rounded ($800K).
- Keep on-chart labels minimal, full detail in hover tooltips. Existing vs
  net-new is solid vs diagonal stripe in the **same hue**, not light/dark shades.
  Wide-range bar axes use a sqrt-compressed scale — note it and keep exact
  figures on hover. Align stacked sections to one frame (`.wrap`, max-width
  1120px, 18px horizontal padding).

## Deploy loop

```bash
npm run typecheck
npx ntn workers deploy          # then WAIT — an immediate render can race the new bundle
npx ntn workers webhooks list   # get URLs
curl -X POST <url> -d '{}'
npx ntn workers runs list
npx ntn workers runs logs <id>
```

Inspect the Sheet via the `inspectSheet` webhook (set the `INSPECT_TAB` env var).
Routine "report updated" Slack posts were removed on purpose — only failures and
rare new-card notices post to `#forecast-ops`.

## Gotchas that already bit

- **Deal Stage Changes cannot give cycle time.** Timestamps were bulk-imported,
  mostly with 0-week gaps. The simulator treats a 0-week gap as unknown and falls
  back to a ~8-week cohort cycle.
- **Double rollover blanked notes.** Client Partner "Actions to Grow" /
  "Last Week's Actions" are preserved across renders, keyed by the Deal HYPERLINK
  URL. Rollover fires only on a `{"rollover":true}` payload from the Sheet's Apps
  Script menu. A render takes ~40s, and one menu click produced **two** deliveries
  ~10s apart; `renderGuard.ts` (best-effort, ~1s read-then-write window, 90s TTL)
  did not dedupe them, so the second rollover cleared the notes. Fixed by making
  rollover **idempotent** — it only moves a non-empty Actions into Last Week.
  Keep it that way. Lost notes are recoverable only via the Sheet's
  File → Version history; there is no cell-level history through the API.

## Open threads

- **ZenDesk Sell CRM export** (`~/…/My Drive/Downloads/2026.09.08 - ZenDesk Sell CRM Export.zip`)
  is still unprocessed. Should hold real historical close and stage dates, which
  would give an actual sales-cycle time-to-close instead of the ~8-week fallback.
- **2026.01 financials backfill is done.** It did not change the 16 simulator
  templates — the workbook has no per-client 2025 monthlies. Company revenue:
  2022 $12.16M peak → 2024 $3.66M trough → 2025 $4.83M recovering. Clients with
  real 2026 revenue but no won-arc: Frictionless (~$900K/yr), KAES-LoadView
  (~$720K/yr), Front Door Home, Mapline, Learnit, Frank Joelle. Expansion not
  captured in schedules: Blue Stream Fiber, Ventrickle, Orange EV, GeniusLink,
  Morgan Group — the fix is upstream (log expansion as won schedules), not
  hardcoding finance numbers.
