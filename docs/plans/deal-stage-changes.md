# Plan: Deal Stage Changes cleanup and calibrated win rates

Working plan for fixing how stage history is recorded, so we can use **real win rates by stage**
instead of the nominal CRM percentages. Audit findings and numbers live in `CLAUDE.md`
(Gotchas → "Deal Stage Changes"). Update the checkboxes here as items land.

**Last updated:** 2026-11-06

## Why

Count-based win rates from Deal Stage Changes (Feb–Nov 2026) run well above the CRM
percentages from Estimating up, so weighted pipeline likely **understates** late-stage deals:

| Stage | CRM % | Actual (resolved deals) |
| --- | --- | --- |
| New Opportunity | 10% | 25% (20 resolved) |
| Qualifying | 20% | 30%, maybe ~17% (40 resolved) |
| Estimating | 40% | 75% (36) |
| Negotiating | 60% | 86% (28) |
| Closing | 80% | 97% (30) |

The early-stage numbers are shaky because the starting stage often isn't recorded (item 1).

## Status

| # | Item | Owner | Status |
| --- | --- | --- | --- |
| 1 | Log the starting stage when a deal is created | Andon (Notion automation) | Configured, needs trigger check + test |
| 2 | Fix or retire "Days Between Stages" | Andon to check automation; Claude computes from `Date` | Open |
| 3 | Delete 9 duplicate rows | Claude | **Done** 2026-11-06 (in Notion trash until ~Dec 6) |
| 4 | Handle multi-stage jumps (people, process, technical) | Team + Claude | Open |
| 5 | Decide whether to retire the Deals `Value` field | Andon | Open |
| 6 | Backfill history from the ZenDesk export | Andon (fields) + Claude (import) | Open |
| 7 | Build calibrated win rates in the worker | Claude | Not started (after 1 and 3) |

## 1. Log the starting stage on deal creation

**Done:** a Notion automation on Deals, "Add page to Deal Stage Changes" (template
"Stage Change"): Deal = Trigger page, Stage = Trigger page → `ZD | Stage`, Notes =
"Automated entry from Deal creation".

Still to do:

- [ ] Confirm the trigger is **Page added** (Deals database).
- [ ] Add **Changed By** = the person who triggered it (matches the stage-change automation).
- [ ] Test: create a deal from the normal template, check exactly **one** row appears with
      the right Stage (not blank), then delete the test deal and its row.
- [ ] Check a deal created by the CRM "Sales Qualified → Deal Creator" agent. It already
      writes its own creation row, and the stage-change automation also fires, so it could
      now get **three** rows. Remove the logging step from the agent (or keep only one source).
- [ ] Claude: ignore a repeat of the same deal + stage within 5 minutes when computing.

## 2. "Days Between Stages"

It's a number set by the automation, not a formula. The data shows it changed over time:
0 on every row Mar 2–Jun 8, blank on many rows since June, and on 53 rows it measures from an
older baseline (~104 days vs a real ~10-day gap). Only ~74 rows are right.

- [ ] Andon: open the stage-change automation and see how this field is set (likely from the
      Deal's "Last Stage Change Date", which is blank on 33 deals).
- [ ] Decide: **delete the field** (recommended), fix the automation, or have the worker write
      correct values back.
- [ ] Claude: compute gaps from each row's `Date` in the worker regardless.

## 3. Duplicates (deleted 2026-11-06)

Same deal + same stage within 5 minutes. Keep the row with notes, else the earlier one.

| Deal | Delete |
| --- | --- |
| BLTEST2 TEST Deal (Estimating ×3) | 2 extra rows (`3534ed00-8078-81c9…`, `3534ed00-8078-817b…`) |
| Sun Life Event-Centric Claims (Pluris 002) | bot row `3c34ed00-8078-8196…` |
| Acieta Knowledge & AI Platform (Pluris 003) | bot row `3e44ed00-8078-8184…` |
| BL187.17 NTI Security Updates (Won ×2) | second row `3e64ed00-8078-8182…` |
| Perella Weinberg Vendor Contract Portal (Pluris 004) | agent row `bce808a2-a14a-4f5d…` (no notes) |
| L&G ETF Prospecting (Pluris 005) | bot row `3f84ed00-8078-81af…` |
| Zumiez | bot row `4014ed00-8078-8185…` |
| Klehr AI Strategy & Training | bot row `4014ed00-8078-81f3…` |

- [x] Moved to Notion trash on 2026-11-06 (restorable for 30 days).
- [ ] Decide whether to exclude the BLTEST2 test deal from all stats.

## 4. Multi-stage jumps

Jumps are real (one call can take a deal from Qualifying to a proposal). The problem is
clicking through every stage in between to catch up.

**Technical**
- [ ] Worker counts every stage below a deal's highest as "reached", so a direct jump needs no
      click-through.
- [ ] Worker merges changes logged within ~10 minutes into one move (keeps time-in-stage right).
- [ ] Optional: a settable "Moved on" date on stage change rows for late updates (shares the
      field from item 6).

**Process**
- [ ] Rule: "set the stage the deal is at now; never step through."
- [ ] Stage updates happen in the Tuesday pipeline review, before the 4 PM snapshot.
- [ ] Keep exit criteria per stage visible (Pipeline sheet, column B) so jumps are deliberate.

**People**
- [ ] Client Partners own their deals' stages and update right after client calls.
- [ ] Optional: a light Slack nudge when an open deal hasn't moved in ~30 days.

## 5. The `Value` fields

- This worker uses **neither** `Value` field.
- Deals `Value` is still filled in on 55 of the 75 deals created since June, and Deals
  formulas ("Forecasted Value", "Value Won", maybe others) may use it. Formula definitions
  aren't readable through the API.
- [ ] Andon: check Deals formulas, and whether the dppt / kantata workers read `Value`.
- [ ] If unused: retire Deals `Value`, then the Deal Stage Changes `Value` snapshot with it.

## 6. ZenDesk backfill

`Date` is a created-time property and can't be set, so imported rows need their own date.

- [ ] Andon: add to Deal Stage Changes:
  - **Effective Date** (date, settable)
  - **Stage Date** (formula): Effective Date if set, else `Date`
  - **Source** (select): Live / ZenDesk import
- [ ] Claude: process `2026.09.08 - ZenDesk Sell CRM Export.zip` (Google Drive → Downloads),
      match ZenDesk deals to Notion Deals, import stage history with Effective Date + Source.
- [ ] Claude: worker reads **Stage Date** instead of `Date`.

## 7. Calibrated win rates (the build)

Start after items 1 and 3; items 4 and 6 improve it over time.

- [ ] Win rate per stage = deals that reached it and were won ÷ its deals since won or lost;
      last 12 months; **dollar-weighted** from Deal Revenue Schedules.
- [ ] Pull small samples toward the CRM % until there's enough history.
- [ ] Show a "Calibrated" option next to the CRM numbers (embed + a calibrated weighted row in
      the Pipeline sheet; the existing Variable Probability Weighted Monthly view may fit).
- [ ] First step: dollar-weighted rates on their own, to compare before anything changes.
