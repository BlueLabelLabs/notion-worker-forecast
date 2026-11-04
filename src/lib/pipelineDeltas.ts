/**
 * Week-over-week pipeline changes for the Forecast vs Plan report: the live pipeline compared with
 * the most recent snapshot taken before today (America/New_York). All $ are probability-weighted.
 *   • rows   — net weighted change per client in each focus quarter, with one note per moving deal
 *   • shifts — deals whose start date moved (needs snapshots that record start_date)
 *   • wins   — deals that reached 100% since the snapshot
 *   • losses — deals that dropped to 0% (lost/unqualified) or left the forecast entirely
 * Pure: takes the raw Snapshots rows and live deals, returns plain data for the HTML to render.
 */

import type { DealAgg } from "./render.js";
import { SNAP_COL } from "./snapshot.js";
import { quartersRange, monthToQuarter } from "./forecast.js";

export type DeltaRow = { client: string; dq: number[]; notes: string[] };
export type Shift = { title: string; client: string; days: number }; // days > 0 = later, < 0 = earlier
export type Win = { title: string; client: string; start: string; rev90: number; contract: string };
export type Loss = { title: string; client: string; reason: string };
export type PipelineDeltas = {
  since: string; // snapshot date compared against, "YYYY-MM-DD"
  quarters: string[]; // focus quarters, in column order
  rows: DeltaRow[]; // sorted by |change| in the first quarter
  shifts: Shift[] | null; // null until the compared snapshot records start dates
  wins: Win[];
  losses: Loss[];
};

/** Smallest weighted change that counts as movement (filters rounding noise). */
const MIN_MOVE = 500;
/** Smallest start-date move, in days, worth listing. */
const MIN_SHIFT_DAYS = 3;

type SnapDeal = { title: string; client: string; prob: number; gross: Map<string, number>; start: string };

const num = (x: unknown): number => {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
};
const pct = (p: number) => `${Math.round(p * 100)}%`;
const money = (n: number) => {
  const a = Math.abs(n);
  const s = a >= 1e6 ? `$${(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `$${Math.round(a / 1e3)}K` : `$${Math.round(a)}`;
  return `${n < 0 ? "−" : "+"}${s}`;
};
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 864e5);

/** Gross revenue a deal earns in the 90 days from its start, prorating the boundary months by active days. */
export function revenue90(d: Pick<DealAgg, "byMonth" | "startDate">): number {
  if (!d.startDate) return 0;
  const s = Date.parse(`${d.startDate}T00:00:00Z`);
  const e = s + 90 * 864e5;
  let sum = 0;
  for (const [m, v] of d.byMonth) {
    const [y, mo] = m.split("-").map(Number);
    const ms = Date.UTC(y!, mo! - 1, 1);
    const me = Date.UTC(y!, mo!, 1);
    const activeStart = Math.max(ms, s); // revenue in the start month only accrues from the start date
    if (activeStart >= me || ms >= e) continue;
    sum += (v * (Math.min(me, e) - activeStart)) / (me - activeStart);
  }
  return sum;
}

export function computePipelineDeltas(
  snapRows: unknown[][],
  deals: DealAgg[],
  quarters: string[],
  lossReasons: Map<string, string>,
  today: string, // "YYYY-MM-DD", America/New_York
): PipelineDeltas | null {
  const isDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);
  const since = [...new Set(snapRows.map((r) => String(r?.[SNAP_COL.date] ?? "")))].filter((d) => isDate(d) && d < today).sort().at(-1);
  if (!since) return null;

  const allQ = quartersRange();
  const prev = new Map<string, SnapDeal>();
  let hasStart = false;
  for (const r of snapRows) {
    if (String(r?.[SNAP_COL.date] ?? "") !== since) continue;
    const gross = new Map<string, number>(allQ.map((q, i) => [q, num(r[SNAP_COL.firstQuarter + i])]));
    const start = String(r[SNAP_COL.startDate] ?? "").slice(0, 10);
    if (isDate(start)) hasStart = true;
    prev.set(String(r[SNAP_COL.dealId]), {
      title: String(r[SNAP_COL.title] ?? ""),
      client: String(r[SNAP_COL.client] ?? ""),
      prob: num(r[SNAP_COL.probability]),
      gross,
      start: isDate(start) ? start : "",
    });
  }

  const live = new Map(deals.map((d) => [d.dealId, d]));
  const liveW = (d: DealAgg, q: string) => [...d.byMonthW].reduce((s, [m, v]) => (monthToQuarter(m) === q ? s + v : s), 0);
  const liveG = (d: DealAgg, q: string) => [...d.byMonth].reduce((s, [m, v]) => (monthToQuarter(m) === q ? s + v : s), 0);

  const byClient = new Map<string, DeltaRow>();
  const shifts: Shift[] = [];
  const wins: Win[] = [];
  const losses: Loss[] = [];

  for (const id of new Set([...prev.keys(), ...live.keys()])) {
    const p = prev.get(id);
    const l = live.get(id);
    const title = l?.dealTitle || p?.title || "(untitled deal)";
    const client = l?.client || p?.client || title; // unaccounted New Opportunities stand as their own row
    const lProb = l?.probability ?? 0;
    const pProb = p?.prob ?? 0;
    const dq = quarters.map((q) => (l ? liveW(l, q) : 0) - (p ? (p.gross.get(q) ?? 0) * p.prob : 0));
    const dGross = quarters.reduce((s, q) => s + (l ? liveG(l, q) : 0) - (p?.gross.get(q) ?? 0), 0);
    const shiftDays = hasStart && p?.start && l?.startDate ? dayDiff(l.startDate, p.start) : 0;

    // One plain-language note per moving deal.
    const parts: string[] = [];
    if (!p) parts.push(`new at ${pct(lProb)}`);
    else if (!l) parts.push("removed from forecast");
    else {
      if (lProb >= 0.999 && pProb < 0.999) parts.push("won");
      else if (lProb === 0 && pProb > 0) parts.push("lost");
      else if (Math.abs(lProb - pProb) > 1e-6) parts.push(`${pct(pProb)} → ${pct(lProb)}`);
      if (Math.abs(dGross) >= MIN_MOVE) parts.push(`${money(dGross)} gross`);
      if (Math.abs(shiftDays) >= MIN_SHIFT_DAYS) parts.push(`start ${shiftDays < 0 ? "earlier" : "later"}`);
    }
    if (dq.some((v) => Math.abs(v) >= MIN_MOVE)) {
      const row = byClient.get(client) ?? byClient.set(client, { client, dq: quarters.map(() => 0), notes: [] }).get(client)!;
      dq.forEach((v, i) => (row.dq[i]! += v));
      row.notes.push(`${title}: ${parts.join(", ") || "schedule revised"}`);
    }

    if (l && p && lProb > 0 && Math.abs(shiftDays) >= MIN_SHIFT_DAYS) shifts.push({ title, client, days: shiftDays });
    if (l && lProb >= 0.999 && pProb < 0.999) {
      wins.push({ title, client, start: l.startDate ?? "", rev90: Math.round(revenue90(l)), contract: l.contractType });
    }
    if (p && pProb > 0 && lProb === 0) {
      losses.push({ title, client, reason: l ? lossReasons.get(id) || "Lost" : "Removed from forecast" });
    }
  }

  const rows = [...byClient.values()]
    .filter((r) => r.dq.some((v) => Math.abs(v) >= MIN_MOVE))
    .sort((a, b) => Math.abs(b.dq[0] ?? 0) - Math.abs(a.dq[0] ?? 0));
  return {
    since,
    quarters,
    rows,
    shifts: hasStart ? shifts.sort((a, b) => Math.abs(b.days) - Math.abs(a.days)) : null,
    wins: wins.sort((a, b) => b.rev90 - a.rev90),
    losses,
  };
}
