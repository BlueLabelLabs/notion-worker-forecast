/**
 * renderNotionFunnel webhook — pushes ONE report into the Experimental Reporting page:
 *   • Forecast vs Plan  — per-quarter coverage-gap KPI cards (with glidepath) + chart,
 *     with the gap-closing Simulator stacked directly below it in the same embed.
 * Reads live Deal Revenue Schedules + the Revenue Targets DB, builds both HTMLs, stacks
 * them into a single draggable embed, and updates it idempotently. The older standalone
 * "Pipeline vs Target" and "Gap Simulator" embeds are retired. Errors → #forecast-ops.
 */

import { worker, googleAuth } from "../worker.js";
import { readSegments, readTargets, readStageCycles } from "../lib/notionForecast.js";
import { aggregateDeals } from "../lib/render.js";
import { monthToQuarter, quartersRange } from "../lib/forecast.js";
import { computeGlidepath, type GlideSeries } from "../lib/glidepath.js";
import { buildTemplates, buildBaseline } from "../lib/simulator.js";
import { computePlanRows } from "../lib/planVsPipeline.js";
import { renderPlanHtml } from "../lib/planHtml.js";
import { renderSimulatorHtml } from "../lib/simulatorHtml.js";
import { renderStackedEmbed } from "../lib/embedStack.js";
import { getValuesUnformatted } from "../lib/sheets.js";
import { uploadHtml, syncReportEmbeds, retireReportEmbeds } from "../lib/notionEmbed.js";
import { postForecastOps } from "../lib/slack.js";

/** Experimental Reporting page. The combined report's embed lives in its own draggable container (matched by filename). */
const PAGE_ID = "3d24ed00807880f0aa20f33754e60b61";
const PLAN_FILE = "forecast_vs_plan.html";
/** Retired embeds — deleted from the page on each run so they can't linger. */
const RETIRED_FILES = ["pipeline_vs_target.html", "gap_simulator.html"];

const pct = (x: number) => `${Math.round(x * 100)}%`;

worker.webhook("renderNotionFunnel", {
  title: "Render Notion Reports",
  description:
    "Builds Forecast vs Plan (coverage-gap KPIs + chart) with the gap-closing Simulator stacked below it, from live " +
    "Deal Revenue Schedules + the Revenue Targets DB, and pushes it as one embed on the Experimental Reporting page. Errors → #forecast-ops.",
  execute: async (events, { notion }) => {
    for (const _event of events) {
      try {
        const token = process.env.NOTION_API_TOKEN;
        if (!token) throw new Error("NOTION_API_TOKEN not set");

        const segments = await readSegments(notion);
        const deals = aggregateDeals(segments);
        const targets = await readTargets(notion);
        const now = new Date();
        const asOf = now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" });
        const curQuarter = monthToQuarter(`${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`);

        // Coverage glidepath for the current + next quarter (drives the expandable KPI charts).
        // Read from the append-only Snapshots tab; resilient — if unavailable, the KPI cards just
        // won't expand and the rest of the report still renders.
        let glide: GlideSeries[] = [];
        try {
          const sheetId = process.env.FORECAST_SHEET_ID;
          if (sheetId) {
            const quarters = quartersRange();
            const ci = quarters.indexOf(curQuarter);
            const forQ = ci >= 0 ? quarters.slice(ci, ci + 2) : [];
            const snapRows = await getValuesUnformatted(await googleAuth.accessToken(), sheetId, "Snapshots!A2:U100000");
            glide = computeGlidepath(snapRows, targets, quarters, forQ);
          }
        } catch (e) {
          console.warn("[forecast] glidepath unavailable:", e instanceof Error ? e.message : e);
        }

        // Forecast vs Plan — all target quarters + coverage KPI cards (with glidepath) on top.
        const planRows = computePlanRows(segments, targets);
        const htmlPlan = renderPlanHtml(planRows, { asOf, nowQuarter: curQuarter }, glide);

        // Gap-closing simulator — client revenue-arc templates + coverage baseline, driven in-browser.
        // Resilient: if the arc/cycle read fails, we still publish the plan on its own.
        let htmlSim: string | null = null;
        try {
          const wonSegs = await readSegments(notion, { includeArchived: true });
          let cycles = new Map<string, { first: string; won: string | null }>();
          try { cycles = await readStageCycles(notion); } catch (e) { console.warn("[forecast] stage cycles unavailable:", e instanceof Error ? e.message : e); }
          htmlSim = renderSimulatorHtml(buildTemplates(wonSegs, cycles), buildBaseline(deals, targets, quartersRange()), { asOf, curQuarter, today: now.toISOString().slice(0, 10) });
        } catch (e) {
          console.warn("[forecast] simulator unavailable:", e instanceof Error ? e.message : e);
        }

        // Stack plan + simulator into ONE embed (each isolated in its own srcdoc iframe), swapped
        // inside its draggable container so manual placement survives.
        const combined = renderStackedEmbed(htmlSim ? [htmlPlan, htmlSim] : [htmlPlan], "Forecast vs Plan");
        const idPlan = await uploadHtml(token, combined, PLAN_FILE);
        const r = await syncReportEmbeds(token, PAGE_ID, [{ filename: PLAN_FILE, fileUploadId: idPlan }]);

        // Drop the retired standalone embeds (Pipeline vs Target, Gap Simulator) if still present.
        let retired: string[] = [];
        try { retired = await retireReportEmbeds(token, PAGE_ID, RETIRED_FILES); } catch (e) { console.warn("[forecast] retire failed:", e instanceof Error ? e.message : e); }

        // Near-term coverage from the plan rows (weighted pipeline ÷ target for current + next quarter).
        const withTargets = planRows.filter((p) => p.target > 0);
        const near = withTargets.filter((p) => p.q >= curQuarter).slice(0, 2);
        const wtd = (p: (typeof planRows)[number]) => p.signed + p.contW + p.newW;
        const nearTarget = near.reduce((s, p) => s + p.target, 0);
        const nearPct = nearTarget > 0 ? near.reduce((s, p) => s + wtd(p), 0) / nearTarget : 0;
        const fullGap = withTargets.filter((p) => p.q >= curQuarter).reduce((s, p) => s + Math.max(0, p.target - wtd(p)), 0);

        const msg = `:bar_chart: *Notion report updated* — Forecast vs Plan + Simulator · near ${pct(nearPct)} covered, gap ${(fullGap / 1e6).toFixed(1)}M.`;
        const fresh = [...r.created, ...r.migrated];
        console.log(`[forecast] ${msg} (updated=[${r.updated}] created=[${r.created}] migrated=[${r.migrated}] dupes=${r.deletedDupes} retired=[${retired}])`);
        await postForecastOps(msg + (fresh.length ? ` :information_source: new report card added at the page end — drag into place once; future refreshes stay put.` : ""));
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        console.error("[forecast] notion reports failed:", err);
        await postForecastOps(`:x: *Notion reports push failed*: ${m}`);
      }
    }
  },
});
