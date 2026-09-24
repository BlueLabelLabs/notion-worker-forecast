# notion-worker-forecast

A [Notion Worker](https://developers.notion.com) that builds BlueLabel's **monthly revenue
forecast**. It reads Deal Revenue Schedules from Notion, computes prorated and
probability-weighted revenue, rewrites three formatted views in the **Forecast Dashboard**
Google Sheet, and publishes a theme-aware HTML dashboard back into a Notion page.

> This worker started as a fork of `notion-worker-dppt` and originally wrote a single tidy
> "Forecast Facts" fact table for Sheet pivots. That design is historical. `CLAUDE.md` is
> the most detailed reference for current behavior and hard-won constraints.

## What it does

1. **Reads Notion** (`src/lib/notionForecast.ts`) via `notion.dataSources.query`.
2. **Computes the forecast** (`src/lib/forecast.ts`). Each schedule accrues its weekly
   revenue, or a fixed fee when weekly revenue is 0, prorated to months by **calendar days**
   (`weeklyRevenue × days ÷ 7`). Weighted = monthly $ × stage probability. Proration and
   the win-rate haircut are independent and each applied exactly once. Months clamp to
   `MIN_MONTH`…`MAX_MONTH` (roughly 2026-01…2028-12).
3. **Rewrites three Sheet tabs** (`renderForecastViews`): Client Partner, Pipeline, and
   Weighted Monthly.
4. **Publishes a Notion embed** (`renderNotionFunnel`): one stacked HTML document on the
   "Experimental Reporting" page.
5. **Snapshots** the pipeline weekly into an append-only Snapshots tab (`snapshotForecast`).
6. Posts **failures** (and rare new-card notices) to **#forecast-ops**. Routine "report
   updated" posts were removed on purpose.

## Data sources

| Source | ID | Role |
| --- | --- | --- |
| Deal Revenue Schedules | `37bf6504-1608-4bf0-af10-c6e5123cc618` | **Source of truth for $.** Weekly revenue or fixed fee, date window, client account, stage probability |
| Deals | `ee89a6dd-be27-4bc5-bc5f-86b6ef40be2b` | Pipeline records. Open deals with no schedule read as $0 placeholders |
| Revenue Targets | `3d24ed00-8078-809a-9a06-000be9fdbb2d` | One row per quarter, `Name` = "YYYY.Q#". **Source of truth for targets** (never hardcode) |
| Deal Stage Changes | `d893ad12-e8c9-4ce5-8aec-677b09c1c025` | Stage transitions. Timestamps were bulk-imported and are **unreliable** for cycle time |

- **Google Sheet** "Forecast Dashboard": `11B2nldq0THoy_NYhBa7ZAFeb8YWKwn2l_0Rtd0toGyY`.
  Worker-written tabs: Client Partner, Pipeline, Weighted Monthly, Snapshots, and a hidden
  `_forecast_lock`. Auth via the worker's `googleAuth` OAuth capability.
- **Notion "Experimental Reporting" page**: `3d24ed00807880f0aa20f33754e60b61`. Auth via
  `NOTION_API_TOKEN` (the BlueLabel DPPT integration, connected to that page).

## Business rules

**Sales stages.** Probability is the nominal CRM win-rate, not historically calibrated, so
weighted values are a benchmark rather than a hard forecast. Definitions live in
`STAGE_DEFS` in `src/lib/render.ts`.

| Probability | Meaning |
| --- | --- |
| 100% | Contract signed / Won |
| 80% | Verbally agreed, price and start date accepted / Closing |
| 60% | Proposal with pricing **and** a client champion / Negotiating |
| 40% | Discussing scope and timeframe / Estimating |
| 20% | Qualified discussion of objectives and scope / Qualifying |
| 10% | New Opportunity |
| 0% | Lost / Unqualified (excluded from Client Partner and Pipeline tabs) |

**Existing vs net-new.** Open pipeline: net-new = account with 0 won deals, existing = 1 or
more. Committed: new-logo = exactly 1 won deal, expansion = more than 1 ("Expansion
Forecast" in the plan chart).

**Targets.** Read from the Revenue Targets DB. The current ramp runs from roughly $1.2M
(2026.Q1) to a ~$2.69M/quarter plateau by ~2027.Q3.

**Snapshots.** One row per deal per week, keyed to that week's Monday in
America/New_York. A Google Apps Script trigger fires Tuesday ~4 PM ET.

## Sheet views

`renderForecastViews` (`src/lib/render.ts`) rewrites Client Partner, Pipeline, and Weighted
Monthly from live schedules. Tabs are addressed by stable `sheetId`, so renaming them in the
Sheet is safe.

**These tabs are overwritten on every render.** To change a layout, hand-edit it in the
Sheet, then replicate that edit in `render.ts`.

- **Pipeline** has an 8-row Stats block (QoQ Target Growth, QoQ Actual Growth, Closed,
  Weighted Value, Target, Weighted Gap, Coverage %, Closed %). Header and merges span rows
  1–11, and deals start at row 12. The empty 0% tier is suppressed.
- **Client Partner** preserves "Actions to Grow" and "Last Week's Actions" across renders,
  keyed by the Deal HYPERLINK URL. Rollover fires only on a `{"rollover":true}` payload from
  the Sheet's Apps Script menu, and is **idempotent**: it only moves a non-empty Actions
  value into Last Week.

## Notion embed

One draggable embed, `forecast_vs_plan.html`, stacks three reports:

1. **Forecast vs Plan**: KPI cards, glidepath, and windowed bars (`planHtml.ts`).
2. **Coverage Funnel**: open pipeline by stage (10–80%) per near-quarter window against a
   per-stage ideal minimum (`funnelHtml.ts`, `coverageFunnel.ts`). Three models via toggle:
   Single-stage, **Distributed** (default), and Actual. Gap = target − Won.
3. **Gap Simulator**: per-account revenue arcs from won deals, excluding accounts whose
   earliest BL number is below 360 (`simulatorHtml.ts`, `simulator.ts`). It uses an
   unclamped spread so pre-2026 arcs render fully.

The reports are authored independently and merged into **one document** by
`renderStackedEmbed` (`embedStack.ts`), because Notion's embed sandbox strips nested
`<iframe srcdoc>`. Each section's CSS is scoped under a wrapper class and shared ids are
disambiguated. Embeds live in per-report synced-block containers matched by filename
(`syncReportEmbeds` in `notionEmbed.ts`), so a refresh swaps the embed and manual placement
survives. Notion API v2026-03-11 embeds have no settable height and uploads are immutable.

## Webhooks

| Webhook | Purpose |
| --- | --- |
| `renderForecastViews` | Rewrites Client Partner, Pipeline, and Weighted Monthly |
| `renderNotionFunnel` | Builds and publishes the stacked Notion embed |
| `snapshotForecast` | Appends the weekly pipeline snapshot |
| `readComments` | Reads Drive-level comments on the forecast Sheet |
| `inspectSheet` | Temporary: dumps a tab's structure (set `INSPECT_TAB`) |
| `notionPeek` | Temporary: dumps financials tabs for simulator backfill |
| `rebuildForecast` | Legacy: writes the original "Forecast Facts" fact table |

## Layout

```
src/
  worker.ts, index.ts         Worker instance, Google OAuth, webhook registration
  lib/
    notionForecast.ts         Notion reads + data source IDs
    forecast.ts               Calendar-day proration (+ forecast.test.ts)
    render.ts                 Sheet views, STAGE_DEFS
    sheets.ts                 Sheets API helpers
    snapshot.ts               Weekly snapshot rows
    renderGuard.ts            Best-effort render dedupe lock
    notionEmbed.ts            Upload + synced-block embed swap
    embedStack.ts             Merges report HTML into one document
    planHtml.ts, glidepath.ts, planVsPipeline.ts, coverage.ts    Forecast vs Plan
    funnelHtml.ts, coverageFunnel.ts                             Coverage Funnel
    simulatorHtml.ts, simulator.ts                               Gap Simulator
    brandFonts.ts             Base64 NB brand faces
    slack.ts                  #forecast-ops notifier
    notionProps.ts, dates.ts, retry.ts, errors.ts                Shared helpers
  webhooks/                   One file per webhook (see table above)
```

## Setup

Environment variables (`ntn workers env set …`):

- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, then `ntn workers oauth start googleAuth`
- `NOTION_API_TOKEN`: the BlueLabel DPPT integration, connected to the data sources and the
  Experimental Reporting page
- `FORECAST_SHEET_ID`: `11B2nldq0THoy_NYhBa7ZAFeb8YWKwn2l_0Rtd0toGyY`
- `SLACK_BOT_TOKEN`, `SLACK_FORECAST_OPS_CHANNEL`

## Dev and deploy

```bash
nvm use && npm install
npm run typecheck
npm test
npm run deploy                  # or deploy:ci (adds --yes); then WAIT before rendering
npx ntn workers webhooks list   # get URLs
curl -X POST <url> -d '{}'
npx ntn workers runs list
npx ntn workers runs logs <id>
```

The worker declares no managed `worker.database`, so deploys don't prompt and work from a
cloud session.

## Open threads

- **ZenDesk Sell CRM export** is still unprocessed. It should hold real close and stage
  dates, giving an actual time-to-close instead of the simulator's ~8-week fallback.
- **Expansion not captured in schedules** (Blue Stream Fiber, Ventrickle, Orange EV,
  GeniusLink, Morgan Group) and clients with 2026 revenue but no won arc (Frictionless,
  KAES-LoadView, Front Door Home, Mapline, Learnit, Frank Joelle). The fix is upstream: log
  expansion as won schedules rather than hardcoding finance numbers.
