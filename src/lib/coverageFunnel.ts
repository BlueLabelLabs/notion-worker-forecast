/**
 * Coverage-funnel data: per near-quarter window, the current open pipeline broken down
 * by stage (probability tier), split into existing-client vs net-new, plus committed Won.
 * Drives the in-browser funnel, which computes the per-stage "ideal minimum" (gap ÷ win-rate,
 * distributed or single-stage) client-side. Snapshot of today's pipeline; near windows only.
 */

import type { DealAgg } from "./render.js";
import { monthToQuarter } from "./forecast.js";

/** Open probability tiers shown in the funnel (0% dropped — lost/unqualified; 100% is Won). */
const CASCADE = [10, 20, 40, 60, 80];
function snapStage(pct: number): number | null {
  if (pct <= 0) return null;
  let best = CASCADE[0]!, bd = Infinity;
  for (const s of CASCADE) { const d = Math.abs(s - pct); if (d < bd) { bd = d; best = s; } }
  return best;
}

export type FunnelWindow = {
  key: string;
  label: string;
  target: number;
  won: number;
  wex: number; // committed from existing clients (accounts with >1 won deal); rest = new-logo
  wonN: number;
  g: Record<number, number>; // gross open pipeline in-window, per stage
  ex: Record<number, number>; // existing-client share of that gross, per stage
  n: Record<number, number>; // deal count, per stage
};

/** Two near windows: the current quarter, and cumulatively through the next. Targeted quarters only. */
export function buildFunnelWindows(deals: DealAgg[], targets: Map<string, number>, now: Date = new Date()): FunnelWindow[] {
  const curQ = monthToQuarter(`${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`);
  const withT = [...targets.keys()].sort().filter((q) => q >= curQ && (targets.get(q) ?? 0) > 0);
  if (withT.length === 0) return [];
  const cur = withT[0]!;
  const next = withT[1];
  const defs = [{ key: cur, label: cur, qs: [cur] }];
  if (next) defs.push({ key: next, label: `through ${next}`, qs: [cur, next] });

  // Won accounts + how many won deals each holds (>1 ⇒ an established/expansion client).
  const wonAccounts = new Set<string>();
  const wonCount = new Map<string, number>();
  for (const d of deals) {
    if (Math.round(d.probability * 100) >= 100 && d.client) {
      wonAccounts.add(d.client);
      wonCount.set(d.client, (wonCount.get(d.client) ?? 0) + 1);
    }
  }

  return defs.map((win) => {
    const qs = new Set(win.qs);
    const target = win.qs.reduce((s, q) => s + (targets.get(q) ?? 0), 0);
    const g: Record<number, number> = {}, ex: Record<number, number> = {}, n: Record<number, number> = {};
    for (const s of CASCADE) { g[s] = 0; ex[s] = 0; n[s] = 0; }
    let won = 0, wex = 0, wonN = 0;

    for (const d of deals) {
      let inWin = 0;
      for (const [m, v] of d.byMonth) if (qs.has(monthToQuarter(m))) inWin += v;
      if (inWin <= 0) continue;
      const pct = Math.round(d.probability * 100);
      if (pct >= 100) {
        won += inWin; wonN += 1;
        if ((wonCount.get(d.client) ?? 0) >= 2) wex += inWin;
      } else {
        const stage = snapStage(pct);
        if (stage == null) continue; // 0% dropped
        g[stage]! += inWin; n[stage]! += 1;
        if (d.client && wonAccounts.has(d.client)) ex[stage]! += inWin;
      }
    }
    const round = (o: Record<number, number>) => { const r: Record<number, number> = {}; for (const k in o) r[k] = Math.round(o[k]!); return r; };
    return { key: win.key, label: win.label, target: Math.round(target), won: Math.round(won), wex: Math.round(wex), wonN, g: round(g), ex: round(ex), n };
  });
}
