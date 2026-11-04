/**
 * Assertions for the week-over-week Pipeline changes (live vs last snapshot).
 */

import assert from "node:assert/strict";
import type { DealAgg } from "./render.js";
import { computePipelineDeltas, revenue90 } from "./pipelineDeltas.js";
import { SNAPSHOT_HEADERS } from "./snapshot.js";
import { quartersRange } from "./forecast.js";

const QS = quartersRange();
const FOCUS = ["2026.Q4", "2027.Q1"];

function deal(id: string, client: string, prob: number, months: Record<string, number>, startDate?: string): DealAgg {
  const byMonth = new Map(Object.entries(months));
  return {
    dealId: id,
    dealTitle: `${id} title`,
    dealUrl: "",
    clientPartner: "Pat",
    client,
    contractType: "Sprints",
    probability: prob,
    byMonth,
    byMonthW: new Map([...byMonth].map(([m, v]) => [m, v * prob])),
    startDate,
  };
}

/** A Snapshots row in the sheet's column order, gross per quarter. */
function snap(date: string, id: string, client: string, prob: number, quarters: Record<string, number>, start = ""): (string | number)[] {
  const row: (string | number)[] = new Array(SNAPSHOT_HEADERS.length).fill("");
  row[0] = date;
  row[1] = id;
  row[2] = `${id} title`;
  row[3] = client;
  row[5] = prob;
  QS.forEach((q, i) => (row[9 + i] = quarters[q] ?? 0));
  row[9 + QS.length] = start;
  return row;
}

// revenue90: $30K/month from Oct 1 → Oct + Nov fully, ~29 of 31 Dec days.
{
  const d = deal("a", "A", 1, { "2026-10": 30000, "2026-11": 30000, "2026-12": 31000 }, "2026-10-01");
  assert.equal(Math.round(revenue90(d)), 30000 + 30000 + 29000);
  assert.equal(revenue90({ ...d, startDate: undefined }), 0);
}

// No snapshot before today → nothing to compare.
assert.equal(computePipelineDeltas([snap("2026-11-04", "a", "A", 1, {})], [], FOCUS, new Map(), "2026-11-04"), null);
// Only a recent snapshot → use it rather than show nothing.
assert.equal(computePipelineDeltas([snap("2026-11-03", "a", "A", 1, {})], [], FOCUS, new Map(), "2026-11-04")!.since, "2026-11-03");

{
  const snaps = [
    // A newer snapshot (yesterday) is too recent to be the weekly baseline; an older one is superseded.
    snap("2026-11-08", "up", "Up Co", 0.6, { "2026.Q4": 100000 }),
    snap("2026-10-26", "up", "Up Co", 0.4, { "2026.Q4": 1 }),
    snap("2026-11-02", "up", "Up Co", 0.4, { "2026.Q4": 100000 }, "2026-10-01"),
    snap("2026-11-02", "won", "Win Co", 0.8, { "2026.Q4": 50000 }, "2026-11-15"),
    snap("2026-11-02", "gone", "Lost Co", 0.6, { "2026.Q4": 20000 }),
    snap("2026-11-02", "lost", "Lost Co", 0.2, { "2027.Q1": 10000 }),
    snap("2026-11-02", "same", "Flat Co", 0.6, { "2026.Q4": 9000 }, "2026-10-01"),
  ];
  const live = [
    deal("up", "Up Co", 0.6, { "2026-10": 100000 }, "2026-10-01"), // 40% → 60%: +$20K weighted in Q4
    deal("won", "Win Co", 1, { "2026-12": 50000 }, "2026-12-01"), // won, start 16 days later
    deal("lost", "Lost Co", 0, { "2027-01": 10000 }), // lost
    deal("same", "Flat Co", 0.6, { "2026-11": 9000 }, "2026-10-01"), // unchanged
    deal("new", "", 0.1, { "2027-02": 30000 }), // new, no account → stands as its own row
  ];
  const r = computePipelineDeltas(snaps, live, FOCUS, new Map([["lost", "Lost: Budget"]]), "2026-11-09")!;
  assert.equal(r.since, "2026-11-02");
  assert.deepEqual(r.quarters, FOCUS);

  const byClient = new Map(r.rows.map((x) => [x.client, x]));
  assert.equal(byClient.has("Flat Co"), false);
  assert.deepEqual(byClient.get("Up Co")!.dq.map(Math.round), [20000, 0]);
  assert.deepEqual(byClient.get("Win Co")!.dq.map(Math.round), [10000, 0]);
  assert.deepEqual(byClient.get("Lost Co")!.dq.map(Math.round), [-12000, -2000]);
  assert.deepEqual(byClient.get("new title")!.dq.map(Math.round), [0, 3000]);
  assert.match(byClient.get("Up Co")!.notes[0]!, /40% → 60%/);
  assert.match(byClient.get("new title")!.notes[0]!, /new at 10%/);
  // Sorted by the first quarter's absolute change.
  assert.deepEqual(r.rows.map((x) => x.client).slice(0, 3), ["Up Co", "Lost Co", "Win Co"]);

  assert.deepEqual(r.shifts, [{ title: "won title", client: "Win Co", days: 16 }]);
  assert.equal(r.wins.length, 1);
  assert.equal(r.wins[0]!.rev90, 50000); // Dec fully inside the 90 days from Dec 1
  assert.deepEqual(
    r.losses.map((l) => [l.title, l.reason]).sort(),
    [["gone title", "Removed from forecast"], ["lost title", "Lost: Budget"]],
  );
}

// Snapshots without start dates → shifts unknown (null), not "none".
{
  const r = computePipelineDeltas([snap("2026-11-02", "a", "A", 0.4, { "2026.Q4": 1000 })], [deal("a", "A", 0.4, { "2026-10": 1000 }, "2026-12-01")], FOCUS, new Map(), "2026-11-04")!;
  assert.equal(r.shifts, null);
}

console.log("pipelineDeltas: ok");
