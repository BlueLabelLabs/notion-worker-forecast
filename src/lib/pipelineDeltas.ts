/**
 * Week-over-week pipeline changes for the Forecast vs Plan report: the live pipeline compared with
 * the most recent snapshot at least MIN_AGE_DAYS old (America/New_York), so a snapshot taken
 * yesterday doesn't shrink the window to one day. All $ are probability-weighted.
 *   • rows   — net weighted change per client in each focus quarter, with one note per moving deal
 *   • shifts — deals whose timing moved: start-date change when the snapshot records start_date,
 *              else inferred from how the same total revenue moved between quarters
 *   • wins   — deals that reached 100% since the snapshot (a deal new at 100% must earn revenue on
 *              or after the snapshot, so backfilled historical schedules don't read as wins)
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
  shifts: Shift[];
  wins: Win[];
  losses: Loss[];
};

/** Baseline snapshot must be at least this old: Tuesday's run compares against the prior Tuesday. */
const MIN_AGE_DAYS = 6;
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
/** "4 days", "2 weeks", "3 months" — matches the Shifts list in the embed. */
export const duration = (days: number) => {
  const a = Math.abs(days);
  if (a < 14) return `${a} day${a === 1 ? "" : "s"}`;
  if (a < 60) return `${Math.round(a / 7)} weeks`;
  const m = Math.round(a / 30.4);
  return `${m} month${m === 1 ? "" : "s"}`;
};
const quarterStart = (q: string) => {
  const [y, n] = q.split(".Q").map(Number);
  return Date.UTC(y!, (n! - 1) * 3, 1);
};

/**
 * Days the live schedule moved vs the snapshot, inferred from quarter totals: the shift that best
 * maps the live monthly revenue (spread evenly per day) back onto the snapshot's quarters. Only
 * answers when total revenue is unchanged (a re-phase, not a resize) and the fit is close; quarter
 * granularity means moves that stay inside one quarter are invisible until start dates are recorded.
 */
export function inferShiftDays(byMonth: Map<string, number>, prevGross: Map<string, number>, quarters: string[]): number | null {
  const prevTotal = [...prevGross.values()].reduce((s, v) => s + v, 0);
  const liveTotal = [...byMonth.values()].reduce((s, v) => s + v, 0);
  if (prevTotal <= 0 || Math.abs(liveTotal - prevTotal) > Math.max(500, prevTotal * 0.02)) return null;
  const bounds = quarters.map((q, i) => [quarterStart(q), i + 1 < quarters.length ? quarterStart(quarters[i + 1]!) : Infinity] as const);
  const months = [...byMonth].filter(([, v]) => v > 0).map(([m, v]) => {
    const [y, mo] = m.split("-").map(Number);
    const ms = Date.UTC(y!, mo! - 1, 1);
    const me = Date.UTC(y!, mo!, 1);
    return { ms, me, rate: v / (me - ms) };
  });
  const err = (s: number) => {
    const off = s * 864e5; // live moved s days later → move it back to compare with the snapshot
    let e = 0;
    bounds.forEach(([qs, qe], i) => {
      let v = 0;
      for (const m of months) v += m.rate * Math.max(0, Math.min(qe, m.me - off) - Math.max(qs, m.ms - off));
      e += Math.abs(v - (prevGross.get(quarters[i]!) ?? 0));
    });
    return e;
  };
  const e0 = err(0);
  if (e0 <= Math.max(500, prevTotal * 0.02)) return null; // quarters line up: no visible move
  let best = 0;
  let bestErr = e0;
  for (let s = 1; s <= 366; s++) {
    for (const d of [s, -s]) {
      const e = err(d);
      if (e < bestErr - 1) [best, bestErr] = [d, e];
    }
  }
  return best !== 0 && bestErr <= prevTotal * 0.1 ? best : null;
}

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
  const dates = [...new Set(snapRows.map((r) => String(r?.[SNAP_COL.date] ?? "")))].filter((d) => isDate(d) && d < today).sort();
  // Latest snapshot a week back; with no history that old, fall back to the oldest one before today.
  const since = dates.filter((d) => dayDiff(today, d) >= MIN_AGE_DAYS).at(-1) ?? dates[0];
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
    // Timing move: recorded start dates when both sides have one, else inferred from the quarters.
    const shiftDays =
      p && l ? (hasStart && p.start && l.startDate ? dayDiff(l.startDate, p.start) : (inferShiftDays(l.byMonth, p.gross, allQ) ?? 0)) : 0;
    const gq = quarters.map((q) => (l ? liveG(l, q) : 0) - (p?.gross.get(q) ?? 0));

    // One plain-language note per moving deal.
    const parts: string[] = [];
    if (!p) parts.push(`new at ${pct(lProb)}`);
    else if (!l) parts.push("removed from forecast");
    else {
      if (lProb >= 0.999 && pProb < 0.999) parts.push("won");
      else if (lProb === 0 && pProb > 0) parts.push("lost");
      else if (Math.abs(lProb - pProb) > 1e-6) parts.push(`${pct(pProb)} → ${pct(lProb)}`);
      if (Math.abs(shiftDays) >= MIN_SHIFT_DAYS) parts.push(shiftDays > 0 ? `pushed out → ${duration(shiftDays)}` : `pulled up ← ${duration(shiftDays)}`);
      else if (Math.abs(dGross) < MIN_MOVE) {
        // Same revenue in the focus quarters, just re-phased between them.
        const from = gq.findIndex((v) => v <= -MIN_MOVE);
        const to = gq.findIndex((v) => v >= MIN_MOVE);
        if (from >= 0 && to >= 0) parts.push(`revenue moved ${quarters[from]} → ${quarters[to]}`);
      }
      if (Math.abs(dGross) >= MIN_MOVE) parts.push(`${money(dGross)} gross`);
    }
    if (dq.some((v) => Math.abs(v) >= MIN_MOVE)) {
      const row = byClient.get(client) ?? byClient.set(client, { client, dq: quarters.map(() => 0), notes: [] }).get(client)!;
      dq.forEach((v, i) => (row.dq[i]! += v));
      row.notes.push(`${title}: ${parts.join(", ") || "schedule revised"}`);
    }

    if (l && p && lProb > 0 && Math.abs(shiftDays) >= MIN_SHIFT_DAYS) shifts.push({ title, client, days: shiftDays });
    // A deal new at 100% only counts if it earns revenue from the snapshot on: a backfilled schedule
    // for past work (e.g. an old change request logged late) is bookkeeping, not a win.
    const sinceMonth = since.slice(0, 7);
    const isWin = l && lProb >= 0.999 && (p ? pProb < 0.999 : [...l.byMonth].some(([m, v]) => m >= sinceMonth && v > 0));
    if (l && isWin) {
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
    shifts: shifts.sort((a, b) => Math.abs(b.days) - Math.abs(a.days)),
    wins: wins.sort((a, b) => b.rev90 - a.rev90),
    losses,
  };
}
