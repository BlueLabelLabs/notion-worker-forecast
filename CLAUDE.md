# notion-worker-forecast

A [Notion Workers](https://developers.notion.com) worker that builds BlueLabel's
monthly revenue forecast. It reads Deal Revenue Schedules from Notion, computes
prorated and probability-weighted revenue, rewrites three views in a Google
Sheet, and publishes a theme-aware HTML dashboard back into a Notion page.

This is **not** the dppt worker. If dppt context appears in a session, ignore it.

## Brand rule

Always write **"BlueLabel"** — never "Blue Label", "Blue Label Labs", or "BLL".
This applies to code, comments, commit messages, and anything rendered.

## Data sources

Notion, queried via `notion.dataSources.query({ data_source_id })`. IDs live in
`src/lib/notionForecast.ts`.

| Source | ID | Role |
| --- | --- | --- |
| Deal Revenue Schedules | `37bf6504-1608-4bf0-af10-c6e5123cc618` | **Source of truth for $.** weeklyRevenue or fixed fee, date window, client account, stage probability |
| Deals | `ee89a6dd-be27-4bc5-bc5f-86b6ef40be2b` | Pipeline records. Open deals with no schedule read as $0 placeholders (`readOpenPlaceholderDeals`) |
| Revenue Targets | `3d24ed00-8078-809a-9a06-000be9fdbb2d` | One row per quarter. `Name` = "YYYY.Q#". **Source of truth for targets** |
| Deal Stage Changes | `d893ad12-e8c9-4ce5-8aec-677b09c1c025` | One row per stage a deal enters. `Date` (created time) is **reliable from 2026-03**; Feb 2026 rows were bulk-imported — see below |

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
Tuesday ~4 PM ET. Columns: snapshot_date … 12 quarter grosses (J–U), then
`start_date` (V, the deal's Notion Start Date, else its earliest schedule start).
Read positions via `SNAP_COL` in `src/lib/snapshot.ts`; append new columns at the end.

## Sheet views

`renderForecastViews` rewrites Client Partner, Pipeline, and Weighted Monthly
from live schedules. Code in `src/lib/render.ts`, entry point
`src/webhooks/renderForecastViews.ts`. Tabs are addressed by stable `sheetId`,
so renaming them in the Sheet is safe.

**These tabs are worker-generated and overwritten on every render.** The workflow
is: hand-edit the layout in the Sheet, then replicate that edit in `render.ts`.
Do not assume a Sheet edit will survive.

Pipeline Stats is 9 rows (QoQ Target Growth, QoQ Actual Growth, Closed, Weighted
Value, Target, Weighted Gap, Gap to Target, Coverage %, Closed %). Header and
merges span rows 1–12; deals start at row 13. `CLOSED_ROW=4`, `WV_ROW=5`,
`TARGET_ROW=6`. Gap to Target (row 8) is Closed − Target. The empty 0% cascade
tier is suppressed.

**Owner ("Client Partner") on Client Partner, Pipeline, and Snapshots** is the deal's
Client Partner (from its client account); when that is blank — typically a New
Opportunity with no account yet — it falls back to the deal's **Pursuit Lead**
(first person listed; `applyPursuitLeadFallback`). Deals with neither stay under
"(no partner)".

Pipeline columns A–E are attributes: Client Partner, Client, Deal, Contract Format,
Start Date (the deal's Notion Start Date, else its earliest schedule start). Start
Date is its own column group, rendered expanded. The 100% (signed) deal group
renders collapsed so the open pipeline shows first; every other stage renders
expanded. Open-stage start dates are highlighted red within 14 days and orange
within 28.

Client Partner has the same Start Date column (D, after Contract Format): grouped,
expanded, and highlighted the same way, skipping signed deals via Probability (col A). Client Partner is
top-aligned throughout.

## Notion embed

One draggable embed, `forecast_vs_plan.html`: Forecast vs Plan (KPI cards +
glidepath, Pipeline changes, then windowed bars) — hovering a glidepath brackets the gap to target at that point: Closed vs Target on the current-quarter chart, Coverage (weighted pipeline) vs Target on the next-quarter chart on top, then a tab bar holding
Coverage Funnel (default tab) and Gap Simulator (`renderStackedEmbed`'s `tabs`
option; hidden panes stay in the document, toggled with `hidden`). Webhook `renderNotionFunnel`; libs `notionEmbed.ts`,
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

**Pipeline changes** (`pipelineDeltas.ts`, card between the KPI cards and the bar chart, shown only while the KPI line charts are expanded: it opens and closes with them): live vs the
latest snapshot at least 6 days old (ET; a rolling week, so Tuesday's fresh
snapshot doesn't shrink the window to a day), all $ **weighted**. Net change per
client in the two focus quarters with one note per moving deal, sorted by the
selected quarter's biggest movers (quarter toggle); Shifts (timing moves of ≥3
days: snapshot `start_date` vs live when both exist, else `inferShiftDays` fits how
an unchanged total moved between quarters; notes read "pushed out → 2 weeks" /
"pulled up ← 2 weeks"; a repeat move in the same stage adds grey "(3rd shift in Negotiating stage)", counted from consecutive weekly snapshots at the current probability); Wins (reached 100%: start, 90-day gross, contract format;
a deal new at 100% must earn revenue from the snapshot month on, so backfilled
past schedules aren't wins); Losses (dropped to
0% with the Deals' `ZD | Stage` + loss-reason multi-selects, or left the forecast).
Loss "detailed reason" (Client Notes, Growth Rally transcripts) is not built yet. Deal and client names link to their Notion pages as mention-style links with the databases' Notion icons (Deals: grey signature-document; Client Accounts: yellow accessibility figure, from the Deals `Client Account` relation). A resize with no other change reads "value increased" / "value decreased".

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

## Slack notice convention

Routine run summaries (forecast rebuilt, snapshot saved, new report card added) go
through `postForecastOpsNotice` in `src/lib/slack.ts`, which posts a Slack `context`
block: the small grey text that Notion's own database automation notifications use,
matching the dppt and kantata workers. Every notice starts with `NOTICE_EMOJI`
(`:notion:`) in the icon slot, then a bold label, then the summary. `:x:` failure
posts via `postForecastOps` stay full-size so they stand out.

## Gotchas that already bit

- **Deal Stage Changes: what it can and can't tell you** (audited 2026-11-06, 468 rows).
  - Rows are written by a Notion database automation when `ZD | Stage` changes. It is
    reliable: every deal's latest row matches its current stage, and 113 of 116 deals
    created since March have history.
  - **Timestamps:** `Date` is the row's created time. February 2026 rows were
    bulk-imported (mostly 0-week gaps); **from 2026-03 rows are live**, so time in
    stage can be measured from `Date` for deals that started after that. The simulator
    still treats a 0-week gap as unknown and falls back to a ~8-week cohort cycle.
  - **The starting stage is often missing.** The automation fires on change, not on
    creation, so only 25 of 182 deals have a first "New Opportunity" row. Deals
    unqualified or won on their first change have only that final row and don't count
    toward any stage's win rate.
  - **CRM-created deals get a double creation row:** the automation's bot row plus one
    written by the CRM "Sales Qualified → Deal Creator" agent (titled
    "New Opportunity — …", with a "Created from CRM contact…" note). Dedupe: same
    deal + same stage within 5 minutes.
  - **Click-throughs:** about 50 rows land within 10 minutes of the previous one
    (several stages stepped through at once). Fine for "stages reached", wrong for
    time in stage.
  - **`Days Between Stages` is unreliable; compute gaps from `Date` instead.** It is 0
    on Mar 2–Jun 8 rows, blank on many rows since June, and on others measures from
    some older baseline (avg 104 days vs a real 10-day gap). Only about 74 rows are right.
  - **`Value` is often empty** (40 final rows, 7 of them Won). Take $ from Deal
    Revenue Schedules, not this field.
  - 247 older closed deals have no history at all. The ZenDesk export is the backfill
    source; `Date` is a created-time property and can't be set, so a backfill needs a
    settable date property.
  - **Win rates by stage** (count-based, deals that reached the stage and are now
    resolved, Feb–Nov 2026): New Opportunity 25%, Qualifying 30% (could be ~17%
    given the missing starting rows), Estimating 75%, Negotiating 86%, Closing 97%.
    From Estimating up these sit well above the nominal CRM rates, so stage-weighted
    values likely **understate** late-stage pipeline. Samples are 28–40 resolved deals
    per stage.
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

## Deploying

```bash
npm run deploy      # local and cloud both work
npm run deploy:ci   # same, with --yes
```

This worker declares **no** managed `worker.database` (it is webhook-only, with no
syncs), so `ntn workers deploy` does not prompt for confirmation and plain
`npm run deploy` works from a cloud session.

`deploy:ci` exists for consistency with the sibling workers, and matters only if a
`worker.sync` is ever added here — syncs require a managed database, and a deploy
that touches linked databases prompts, which a cloud session cannot answer.
