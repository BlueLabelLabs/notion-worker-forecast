/**
 * TEMPORARY — dumps tabs / values from the 2026.01 January Financials dashboard so we can
 * mine per-client 2025 historical revenue to backfill simulator arcs. Delete after use.
 *   FIN_TABS  = comma-separated tab names (default: the key per-client revenue tabs)
 *   FIN_RANGE = A1 range applied to each tab (default A1:BZ60)
 * With no FIN_TABS, logs the full tab list + dimensions.
 */

import { worker, googleAuth } from "../worker.js";
import { getSheetMeta, getValues } from "../lib/sheets.js";

const FIN_SHEET_ID = "1wfZ3E71eF_RajjEIgTDHdCAuro-LFvG7eic314vqo6U";

worker.webhook("notionPeek", {
  title: "Financials Dump (temp)",
  description: "Dumps per-client revenue tabs from the Jan 2026 Financials sheet. Temporary.",
  execute: async () => {
    const token = await googleAuth.accessToken();
    const meta = await getSheetMeta(token, FIN_SHEET_ID);
    console.log(`[fin] TABS=${JSON.stringify(meta.map((m) => m.title))}`);

    const tabs = (process.env.FIN_TABS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const range = process.env.FIN_RANGE ?? "A1:BZ60";
    for (const tab of tabs) {
      try {
        const vals = await getValues(token, FIN_SHEET_ID, `${tab}!${range}`);
        console.log(`[fin] TAB="${tab}" rows=${vals.length}`);
        console.log(`[fin] DATA="${tab}"=${JSON.stringify(vals)}`);
      } catch (e) {
        console.log(`[fin] TAB="${tab}" ERROR ${e instanceof Error ? e.message : e}`);
      }
    }
  },
});
