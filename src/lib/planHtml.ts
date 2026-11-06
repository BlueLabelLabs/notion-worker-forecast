/**
 * "Forecast vs Plan" report for a Notion embed:
 *   • Two coverage KPI cards (current quarter + next; the next two once the current quarter is
 *     in its last 4 weeks) on top — gap to target on the
 *     left, Coverage % / Closed % on the right — each expandable to that quarter's
 *     coverage glidepath (weighted pipeline + closed vs target, by weeks to close).
 *   • A stacked weighted-forecast-vs-target bar chart below, over a rolling window
 *     (2 prior quarters + current + next) with a "Next 2 / Next 4" toggle. Each bar
 *     is coloured by its quarter: the first KPI card's quarter is blue, the second's is
 *     teal; every other quarter is grey.
 * No headings, prose, or table. Brand fonts. Charts are built by inline JS.
 */

import type { PlanRow } from "./planVsPipeline.js";
import type { GlideSeries } from "./glidepath.js";
import type { PipelineDeltas } from "./pipelineDeltas.js";
import { BRAND_FONTS } from "./brandFonts.js";

function money(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e6) return `$${(n / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M`;
  if (a >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
}
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const qid = (q: string) => q.replace(/\./g, "_");
const tlabel = (t: number) => `$${(t / 1e6).toFixed(1)}M`;

function quarterEnd(q: string): Date | null {
  const m = /(\d{4})\.Q([1-4])/.exec(q);
  if (!m) return null;
  const endMonth0 = [2, 5, 8, 11][Number(m[2]) - 1]!;
  return new Date(Date.UTC(Number(m[1]), endMonth0 + 1, 0));
}
function weeksToEnd(q: string): number | null {
  const e = quarterEnd(q);
  return e ? Math.round((e.getTime() - Date.now()) / (7 * 864e5)) : null;
}

const CUR = "#2424FC";
const NXT = "#0D9488";

export function renderPlanHtml(
  rows: PlanRow[],
  meta: { asOf: string; nowQuarter?: string; kpiQuarter?: string },
  glide: GlideSeries[] = [],
  deltas: PipelineDeltas | null = null,
): string {
  // "Since" label for the pipeline-changes card, e.g. "Oct 27".
  const sinceLabel = deltas
    ? new Date(`${deltas.since}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
    : "";
  const deltaCard = !deltas
    ? ""
    : `<div class="card dcard" id="dcard">
    <div class="card-head">
      <div><span class="dtitle">Pipeline changes</span> <span class="asof">since ${esc(sinceLabel)} snapshot &middot; weighted</span></div>
      <div class="seg" id="dsort" role="group" aria-label="Sort by biggest movers in">${deltas.quarters
        .map((q, i) => `<button type="button" data-i="${i}"${i === 0 ? ' class="on"' : ""}>${esc(q)}</button>`)
        .join("")}</div>
    </div>
    <div id="dbody">
    <div class="dscroll"><table class="dt">
      <thead><tr><th>Client</th>${deltas.quarters.map((q, i) => `<th class="num" data-i="${i}">${esc(q)}</th>`).join("")}<th>What changed</th></tr></thead>
      <tbody id="drows"></tbody>
    </table></div>
    <div class="dsub"><h3>Shifts</h3><div id="dshifts"></div></div>
    <div class="dsub"><h3>Wins</h3><div class="dscroll"><table class="dt" id="dwins"></table></div></div>
    <div class="dsub"><h3>Losses</h3><div class="dscroll"><table class="dt" id="dlosses"></table></div></div>
    </div>
  </div>`;
  const data = rows.map((r) => {
    const tot = r.signed + r.contW + r.newW;
    return { q: r.q, t: r.target, s: r.signed, cw: r.contW, nw: r.newW, tot, gap: tot - r.target, pc: (tot / (r.target || 1)) * 100 };
  });
  const nowIdx = meta.nowQuarter ? rows.findIndex((r) => r.q === meta.nowQuarter) : -1;
  const kpiQ = meta.kpiQuarter ?? meta.nowQuarter;
  const kpiIdx = kpiQ ? rows.findIndex((r) => r.q === kpiQ) : -1;

  // Per-quarter glidepath series for the KPI charts (first card = blue, second = teal).
  // Both charts share one Y axis so the two quarters compare at a glance.
  const series = glide.filter((s) => s.points.length > 1);
  const sharedYMax = Math.max(
    5e5,
    ...series.map((s) => Math.ceil(Math.max(s.target * 1.2, ...s.points.map((p) => Math.max(p.cov, p.closed) * s.target)) / 5e5) * 5e5),
  );
  const GLIDE = series
    .map((s, k) => {
      const maxWte = Math.max(...s.points.map((p) => p.wte), 4);
      return {
        quarter: s.quarter,
        color: k === 0 ? CUR : NXT,
        gapKey: k === 0 ? "x" : "c", // hover gap: current quarter = Closed vs Target, next = Coverage vs Target
        gapLabel: k === 0 ? "Closed gap" : "Coverage gap",
        tlabel: tlabel(s.target),
        target: s.target,
        ymax: sharedYMax,
        xmax: Math.ceil(maxWte / 4) * 4,
        points: s.points.map((p) => ({ w: p.wte, c: p.cov, x: p.closed, d: p.date })),
      };
    });
  const hasChart = new Set(GLIDE.map((g) => g.quarter));

  function kpi(i: number, color: string): string {
    if (i < 0 || i >= data.length) return "";
    const d = data[i]!;
    const cov = Math.round(d.pc);
    const closed = Math.round((d.s / (d.t || 1)) * 100);
    const wte = weeksToEnd(d.q);
    const when = wte == null ? "" : wte <= 0 ? "closing now" : wte <= 14 ? `${wte} weeks to close` : `~${Math.round(wte / 13)} quarter${wte > 19 ? "s" : ""} out`;
    const chart = hasChart.has(d.q);
    const chev = chart
      ? `<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`
      : "";
    const summary = `<div class="ktop"><span class="kdot" style="background:${color}"></span>${esc(d.q)}<span class="kwhen">${when}</span>${chev}</div>
      <div class="krow">
        <div class="kgap"><span class="kn ${d.gap < 0 ? "neg" : "pos"}">${d.gap < 0 ? "−" : "+"}${money(Math.abs(d.gap))}</span><span class="kk">Coverage Gap</span></div>
        <div class="kmetrics">
          <div class="km"><span class="kn">${cov}%</span><span class="kk">Coverage</span></div>
          <div class="km"><span class="kn">${closed}%</span><span class="kk">Closed</span></div>
        </div>
      </div>`;
    if (!chart) return `<div class="kpi">${summary}</div>`;
    return `<details class="kpi"><summary class="ksum">${summary}</summary>
      <div class="kbody">
        <div class="glegend"><span><i class="gl" style="border-top:2.5px solid ${color}"></i>Closed (won)</span><span><i class="gl" style="border-top:2.5px dashed ${color}"></i>Weighted pipeline</span><span><i class="gl" style="border-top:2px dashed #64748B"></i>Target</span></div>
        <div class="gchart" id="g-${qid(d.q)}"></div>
      </div></details>`;
  }
  const kpis = kpi(kpiIdx, CUR) + kpi(kpiIdx + 1, NXT);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Forecast vs Plan</title>
<style>
${BRAND_FONTS}
  :root{
    --surface:#FFFFFF; --panel:#FbFbFd; --panel-hover:#F4F5F9; --ink:#1E293B; --ink-2:#64748B; --ink-3:#94A3B8;
    --hair:#E2E8F0; --hair-strong:#CBD5E1; --brand:#2424FC; --grid:#E9EDF3; --axis:#CBD5E1;
    --good-ink:#046904; --warn-ink:#8A5A00; --crit-ink:#B02525;
    --font:"NB International Pro","Helvetica Neue",Arial,sans-serif; --book:"NB Book","Helvetica Neue",Arial,sans-serif; --mono:"NB Mono","SFMono-Regular",Menlo,monospace;
  }
  @media (prefers-color-scheme:dark){ :root:not([data-theme="light"]){
    --surface:#0E1017; --panel:#161922; --panel-hover:#1C212C; --ink:#E7EAF1; --ink-2:#A6AEBE; --ink-3:#6B7688;
    --hair:#242938; --hair-strong:#333B4D; --brand:#8A8AFF; --grid:#1E2330; --axis:#333B4D;
    --good-ink:#5FD08A; --warn-ink:#E0B15A; --crit-ink:#F0857A;
  }}
  :root[data-theme="dark"]{
    --surface:#0E1017; --panel:#161922; --panel-hover:#1C212C; --ink:#E7EAF1; --ink-2:#A6AEBE; --ink-3:#6B7688;
    --hair:#242938; --hair-strong:#333B4D; --brand:#8A8AFF; --grid:#1E2330; --axis:#333B4D;
    --good-ink:#5FD08A; --warn-ink:#E0B15A; --crit-ink:#F0857A;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--surface);color:var(--ink);font-family:var(--font);-webkit-font-smoothing:antialiased}
  .wrap{max-width:1120px;margin:0 auto;padding:18px}
  /* KPI cards */
  .kpis{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
  .kpi{border:1px solid var(--hair);border-radius:4px;background:var(--panel);overflow:hidden}
  details.kpi[open]{background:var(--surface)}
  .ksum,.kpi>.ktop{list-style:none}
  summary.ksum{list-style:none;cursor:pointer;padding:15px 16px;outline:none;display:block}
  summary.ksum::-webkit-details-marker{display:none}
  summary.ksum:hover{background:var(--panel-hover)}
  details.kpi[open] summary.ksum:hover{background:transparent}
  summary.ksum:focus-visible{box-shadow:inset 0 0 0 2px var(--brand)}
  div.kpi{padding:15px 16px}
  .ktop{display:flex;align-items:center;gap:9px;font-family:var(--book);font-size:13px;color:var(--ink)}
  .kdot{width:10px;height:10px;border-radius:2px;flex:0 0 auto}
  .kwhen{margin-left:auto;font-size:11.5px;color:var(--ink-3)}
  .chev{width:15px;height:15px;color:var(--ink-3);transition:transform .18s ease;flex:0 0 auto;margin-left:10px}
  details.kpi[open] .chev{transform:rotate(180deg)}
  .krow{display:flex;gap:16px;margin-top:12px;align-items:baseline}
  .kmetrics{display:flex;gap:22px;margin-left:auto;align-items:baseline}
  .km .kn,.kmetrics .kn{font-size:29px}
  .kn{font-family:var(--mono);font-variant-numeric:tabular-nums;line-height:1;letter-spacing:-.5px}
  .kk{display:block;font-family:var(--book);text-transform:uppercase;letter-spacing:1.2px;font-size:9px;color:var(--ink-3);margin-top:6px}
  .kgap .kn{font-size:23px}
  .kn.neg{color:var(--crit-ink)} .kn.pos{color:var(--good-ink)}
  .kbody{border-top:1px solid var(--hair);padding:12px 14px 6px}
  .glegend{display:flex;gap:14px;flex-wrap:wrap;margin-bottom:4px;font-size:11px;color:var(--ink-2)}
  .glegend span{display:flex;align-items:center;gap:6px}
  .gl{width:16px;height:0;border-top-width:2.5px;flex:0 0 auto}
  .gchart{overflow-x:auto}
  .gchart svg{width:100%;height:auto;display:block;min-width:440px}
  /* Chart card */
  .card{background:var(--surface);border:1px solid var(--hair);border-radius:4px;padding:14px 16px 12px;margin-top:14px}
  .card-head{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;margin-bottom:8px}
  .seg{display:inline-flex;border:1px solid var(--hair-strong);border-radius:20px;overflow:hidden}
  .seg button{appearance:none;border:0;background:transparent;color:var(--ink-2);font-family:var(--book);font-size:12px;padding:5px 13px;cursor:pointer}
  .seg button.on{background:var(--brand);color:#fff}
  .seg button:focus-visible{outline:2px solid var(--brand);outline-offset:1px}
  .asof{font-size:12px;color:var(--ink-3)}
  .legend{display:flex;gap:15px;flex-wrap:wrap;margin:4px 0 4px;font-size:11.5px;color:var(--ink-2)}
  .legend span{display:flex;align-items:center;gap:6px}
  .sw{width:11px;height:11px;border-radius:2px;flex:0 0 auto}
  .line{width:15px;height:0;border-top:2px solid var(--ink)}
  .chart{overflow-x:auto}
  .chart svg{max-width:100%;height:auto;display:block}
  .tt{position:fixed;z-index:80;pointer-events:none;opacity:0;transition:opacity .1s;background:var(--surface);border:1px solid var(--hair-strong);border-radius:3px;box-shadow:0 8px 26px rgba(15,23,42,.14);padding:10px 12px;font-size:12px;min-width:180px}
  .tt.on{opacity:1}
  .tt-h{font-family:var(--book);font-size:11px;letter-spacing:1.4px;text-transform:uppercase;color:var(--ink-3);margin-bottom:6px}
  .tt-r{display:flex;align-items:center;gap:8px;justify-content:space-between;line-height:1.7}
  .tt-r .l{display:flex;align-items:center;gap:7px;color:var(--ink-2)}
  .tt-r .v{font-family:var(--mono);color:var(--ink)}
  .tt-r .sw{width:9px;height:9px;border-radius:2px}
  /* Pipeline changes */
  .dtitle{font-family:var(--book);font-size:13px;color:var(--ink)}
  .dscroll{overflow-x:auto}
  .dt{width:100%;border-collapse:collapse;font-size:12.5px}
  .dt th{font-family:var(--book);font-weight:400;text-transform:uppercase;letter-spacing:1px;font-size:9.5px;color:var(--ink-3);text-align:left;padding:6px 10px;border-bottom:1px solid var(--hair-strong);white-space:nowrap}
  .dt th.on{color:var(--ink)}
  .dt td{padding:7px 10px;border-bottom:1px solid var(--hair);vertical-align:top;color:var(--ink)}
  .dt .num{text-align:right;font-family:var(--mono);font-variant-numeric:tabular-nums;white-space:nowrap}
  .dt td.up{color:var(--good-ink)} .dt td.down{color:var(--crit-ink)} .dt td.flat{color:var(--ink-3)}
  .dt .sub{display:block;font-size:11.5px;color:var(--ink-2);line-height:1.5}
  .dt .why{color:var(--ink-2);font-size:11.5px;line-height:1.55}
  .dsub{margin-top:16px}
  .dsub h3{font-family:var(--book);font-weight:400;font-size:12px;letter-spacing:1.2px;text-transform:uppercase;color:var(--ink-2);margin:0 0 6px}
  .dshift{display:flex;gap:10px;align-items:baseline;font-size:12.5px;padding:4px 0;color:var(--ink)}
  .dshift .ar{font-family:var(--mono);white-space:nowrap}
  .dshift .ar.early{color:var(--good-ink)} .dshift .ar.late{color:var(--warn-ink)}
  .dshift .cl{color:var(--ink-3);font-size:11.5px}
  .mention{color:inherit;text-decoration:none;white-space:normal}
  .mention svg{width:15px;height:15px;vertical-align:-3px;margin-right:2px;color:#A6A299}
  .mention.acct svg{color:#CB912F}
  @media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .mention svg{color:#7F7F7F}:root:not([data-theme="light"]) .mention.acct svg{color:#CA8E1B}}
  :root[data-theme="dark"] .mention svg{color:#7F7F7F}
  :root[data-theme="dark"] .mention.acct svg{color:#CA8E1B}
  .mention span{border-bottom:1px solid var(--hair)}
  .mention:hover span{border-bottom-color:var(--ink-3)}
  .dempty{font-size:12px;color:var(--ink-3);padding:4px 0}
  @media(max-width:560px){.kpis{grid-template-columns:1fr}}
  @media(prefers-reduced-motion:reduce){*{transition:none!important}}
</style>
</head>
<body>
<div class="wrap">
  <div class="kpis">${kpis}</div>
  ${deltaCard}
  <div class="card">
    <div class="card-head">
      <div class="seg" role="group" aria-label="Forecast horizon">
        <button id="b2" class="on" type="button">Next 2 Qtrs</button>
        <button id="b4" type="button">Next 4 Qtrs</button>
      </div>
      <span class="asof">USD &middot; as of ${esc(meta.asOf)}</span>
    </div>
    <div class="legend">
      <span><i class="sw" style="background:#64748B"></i>Signed (100%)</span>
      <span><i class="sw" style="background:#94A3B8"></i>Expansion Forecast, weighted</span>
      <span><i class="sw" style="background:#CBD5E1"></i>Net-new, weighted</span>
      <span><i class="line"></i>Target</span>
    </div>
    <div class="chart"><div id="c-plan"></div></div>
  </div>
</div>
<div class="tt" id="tt" role="status" aria-live="polite"></div>
<script>
(function(){
  var PLAN = ${JSON.stringify(data)};
  var NOWIDX = ${nowIdx};
  var KPIIDX = ${kpiIdx};
  var GLIDE = ${JSON.stringify(GLIDE)};
  var NS="http://www.w3.org/2000/svg";
  function el(tag,a){var e=document.createElementNS(NS,tag);for(var k in a)e.setAttribute(k,a[k]);return e;}
  function usdS(n){var a=Math.abs(n);if(a>=1e6)return "$"+(n/1e6).toFixed(a%1e6?(a>=1e7?1:2):0).replace(/\\.?0+$/,"")+"M";if(a>=1e3)return "$"+Math.round(n/1e3)+"K";return "$"+Math.round(n);}
  var TT=document.getElementById("tt");
  function ttMove(ev){var pad=14,w=TT.offsetWidth,h=TT.offsetHeight,x=ev.clientX+pad,y=ev.clientY+pad;if(x+w>innerWidth)x=ev.clientX-w-pad;if(y+h>innerHeight)y=ev.clientY-h-pad;TT.style.left=x+"px";TT.style.top=y+"px";}
  function ttShow(ev,html){TT.innerHTML=html;TT.classList.add("on");ttMove(ev);}
  function ttHide(){TT.classList.remove("on");}
  function row(sw,label,val){return '<div class="tt-r"><span class="l">'+(sw?'<i class="sw" style="background:'+sw+'"></i>':'')+label+'</span><span class="v">'+val+'</span></div>';}

  // Share of a "YYYY.Q#" quarter elapsed as of today (0..1), and whole days left in it.
  function quarterProgress(q){
    var m=/(\\d{4})\\.Q([1-4])/.exec(q); if(!m)return {frac:0,left:0};
    var y=+m[1], m0=(+m[2]-1)*3, start=Date.UTC(y,m0,1), end=Date.UTC(y,m0+3,1), d=new Date();
    var today=Date.UTC(d.getFullYear(),d.getMonth(),d.getDate());
    return {frac:Math.min(1,Math.max(0,(today-start+864e5)/(end-start))), left:Math.max(0,Math.round((end-today)/864e5))};
  }

  // ---- Plan bar chart (windowed) ----
  var BLUE=["#2424FC","#6E6EFD","#A3A3FE"], TEAL=["#0D9488","#59B3AB","#A7D8D2"], GREY=["#64748B","#94A3B8","#CBD5E1"];
  function windowFor(mode){
    var base=(NOWIDX<0?0:NOWIDX), fwd=(KPIIDX<0?base:KPIIDX);
    var start=Math.max(0, base-2), end=Math.min(PLAN.length, fwd + (mode==="4"?4:2));
    return {rows:PLAN.slice(start,end), nowRel:NOWIDX-start, kpiRel:fwd-start};
  }
  function draw(mode){
    var host=document.getElementById("c-plan"); host.innerHTML="";
    var win=windowFor(mode), P=win.rows, nowRel=win.nowRel, kpiRel=win.kpiRel;
    function fam(i){return i===kpiRel?BLUE:(i===kpiRel+1?TEAL:GREY);}
    var W=1040,H=350,PL=58,PR=18,PT=30,PB=44,pw=W-PL-PR,ph=H-PT-PB;
    var band=pw/Math.max(P.length,1), bw=Math.min(60,band*0.52);
    var rawMax=Math.max.apply(null,P.map(function(p){return Math.max(p.t,p.tot);}).concat([5e5]));
    var YMAX=Math.ceil(rawMax/5e5)*5e5, y=function(v){return PT+ph-(v/YMAX)*ph;};
    var svg=el("svg",{viewBox:"0 0 "+W+" "+H,width:W,role:"img","aria-label":"Weighted forecast vs target by quarter"});
    for(var g=0;g<=4;g++){var tv=YMAX*g/4;svg.appendChild(el("line",{x1:PL,x2:W-PR,y1:y(tv),y2:y(tv),stroke:g===0?"var(--axis)":"var(--grid)","stroke-width":g===0?1.3:1}));var yl=el("text",{x:PL-9,y:y(tv)+3.5,"text-anchor":"end",fill:"var(--ink-3)","font-size":10,"font-family":'"NB Mono",monospace'});yl.textContent=g===0?"0":usdS(tv);svg.appendChild(yl);}
    // NOW slides across the current quarter's column as the quarter elapses (computed in the
    // viewer's browser, so it stays accurate between refreshes). Drawn before the bars, so it
    // passes behind them.
    if(nowRel>=0&&nowRel<P.length){
      var qp=quarterProgress(P[nowRel].q), nx=PL+band*(nowRel+qp.frac);
      svg.appendChild(el("line",{x1:nx,x2:nx,y1:PT-8,y2:PT+ph,stroke:"var(--ink)","stroke-width":1.2,opacity:.35}));
      var right=nx>W-PR-150, nl=el("text",{x:right?nx-6:nx+6,y:PT-12,"text-anchor":right?"end":"start",fill:"var(--ink-2)","font-size":9.5,"font-family":'"NB Book",sans-serif'});
      nl.setAttribute("letter-spacing","1.4px");nl.textContent="NOW · "+(qp.left<=0?"QUARTER CLOSED":qp.left+(qp.left===1?" DAY":" DAYS")+" LEFT");svg.appendChild(nl);
    }
    var hl=el("rect",{x:PL,y:PT,width:band,height:ph,fill:"var(--brand)","fill-opacity":".06",opacity:0,"pointer-events":"none"});svg.appendChild(hl);
    P.forEach(function(p,i){
      var cx=PL+band*i+band/2, x=cx-bw/2, acc=0, cols=fam(i);
      [[cols[0],p.s],[cols[1],p.cw],[cols[2],p.nw]].forEach(function(sg){
        if(sg[1]<=0)return;var h=(sg[1]/YMAX)*ph;if(h<1.2)h=1.2;
        svg.appendChild(el("rect",{x:x,y:y(acc+sg[1]),width:bw,height:h,fill:sg[0]}));
        if(acc>0)svg.appendChild(el("rect",{x:x,y:y(acc+sg[1])+h-1,width:bw,height:2,fill:"var(--surface)"}));
        acc+=sg[1];
      });
      svg.appendChild(el("line",{x1:x-7,x2:x+bw+7,y1:y(p.t),y2:y(p.t),stroke:"var(--ink)","stroke-width":2.5}));
      var pl=el("text",{x:cx,y:y(p.tot)-8,"text-anchor":"middle",fill:p.gap>=0?"var(--good-ink)":"var(--crit-ink)","font-size":11.5,"font-family":'"NB Mono",monospace'});pl.textContent=(p.gap<0?"−":"+")+usdS(Math.abs(p.gap));svg.appendChild(pl);
      var lb=el("text",{x:cx,y:H-PB+18,"text-anchor":"middle",fill:i>=nowRel&&nowRel>=0?"var(--ink-2)":"var(--ink-3)","font-size":10,"font-family":'"NB Mono",monospace'});lb.textContent=p.q;svg.appendChild(lb);
      var hit=el("rect",{x:PL+band*i,y:PT,width:band,height:ph,fill:"transparent",tabindex:0,role:"button","aria-label":p.q+" at "+Math.round(p.pc)+"% of target"});hit.style.cursor="crosshair";
      var html='<div class="tt-h">'+p.q+'</div>'+row(null,"<b>Target</b>","<b>"+usdS(p.t)+"</b>")+row(cols[0],"Signed",usdS(p.s))+(p.cw>0?row(cols[1],"Expansion Forecast",usdS(p.cw)):"")+(p.nw>0?row(cols[2],"Net-new",usdS(p.nw)):"")+row(null,"Weighted total",usdS(p.tot))+row(null,p.gap<0?"<b>Gap</b>":"<b>Over plan</b>","<b>"+usdS(Math.abs(p.gap))+"</b>")+row(null,"% of plan",Math.round(p.pc)+"%");
      hit.addEventListener("mouseenter",function(e){hl.setAttribute("x",PL+band*i);hl.setAttribute("opacity",1);ttShow(e,html);});
      hit.addEventListener("mousemove",ttMove);
      hit.addEventListener("mouseleave",function(){hl.setAttribute("opacity",0);ttHide();});
      hit.addEventListener("focus",function(){hl.setAttribute("x",PL+band*i);hl.setAttribute("opacity",1);var b=hit.getBoundingClientRect();ttShow({clientX:b.left+b.width/2,clientY:b.top+30},html);});
      hit.addEventListener("blur",function(){hl.setAttribute("opacity",0);ttHide();});
      svg.appendChild(hit);
    });
    host.appendChild(svg);
  }
  var b2=document.getElementById("b2"), b4=document.getElementById("b4");
  b2.addEventListener("click",function(){b2.classList.add("on");b4.classList.remove("on");draw("2");});
  b4.addEventListener("click",function(){b4.classList.add("on");b2.classList.remove("on");draw("4");});
  draw("2");

  // ---- Pipeline changes (live vs last snapshot) ----
  var DELTAS = ${JSON.stringify(deltas)};
  if (DELTAS) (function(){
    function td(text, cls){var c=document.createElement("td");if(cls)c.className=cls;c.textContent=text;return c;}
    function signed(n){if(Math.abs(n)<500)return "—";var a=Math.abs(n),s=a>=1e6?"$"+(a/1e6).toFixed(1)+"M":"$"+Math.round(a/1e3)+"K";return (n<0?"−":"+")+s;}
    function dur(days){var a=Math.abs(days);return a<14?a+" day"+(a===1?"":"s"):a<60?Math.round(a/7)+" weeks":Math.round(a/30.4)+" month"+(Math.round(a/30.4)===1?"":"s");}
    function mdy(iso){if(!iso)return "—";var p=iso.split("-");return (+p[1])+"/"+(+p[2])+"/"+p[0];}
    function empty(host,msg){var d=document.createElement("div");d.className="dempty";d.textContent=msg;host.appendChild(d);}
    var body=document.getElementById("drows"), table=body.parentNode;
    function rows(sortI){
      body.innerHTML="";
      [].slice.call(table.querySelectorAll("th[data-i]")).forEach(function(th){th.classList.toggle("on",+th.getAttribute("data-i")===sortI);});
      var R=DELTAS.rows.slice().sort(function(a,b){return Math.abs(b.dq[sortI])-Math.abs(a.dq[sortI]);});
      if(!R.length){var tr=document.createElement("tr"),c=td("No weighted changes since the last snapshot.","flat");c.colSpan=DELTAS.quarters.length+2;tr.appendChild(c);body.appendChild(tr);return;}
      R.forEach(function(r){
        var tr=document.createElement("tr");tr.appendChild(acctCell(r));
        r.dq.forEach(function(v){tr.appendChild(td(signed(v),"num "+(Math.abs(v)<500?"flat":v>0?"up":"down")));});
        var why=td("","why");r.notes.forEach(function(n){var s=document.createElement("span");s.className="sub";s.appendChild(mention(n.title,n.url));s.appendChild(document.createTextNode(" "+n.text));why.appendChild(s);});tr.appendChild(why);
        body.appendChild(tr);
      });
    }
    [].slice.call(document.querySelectorAll("#dsort button")).forEach(function(b){
      b.addEventListener("click",function(){[].slice.call(document.querySelectorAll("#dsort button")).forEach(function(o){o.classList.toggle("on",o===b);});rows(+b.getAttribute("data-i"));});
    });

    // Links styled like Notion page mentions, with the Notion icons of the two databases:
    // Deals = grey signature-document, Client Accounts = yellow accessibility figure.
    var ICONS={
      deal:'<svg viewBox="0 0 20 20" aria-hidden="true"><path fill="currentColor" d="M9.375 2.5H3.75v15h12.5V9.375H9.375zm1.25 11.875H15v1.25h-4.375zm-1.25.366-.884.884-1.303-1.303-1.304 1.303L5 14.741l1.303-1.303L5 12.134l.884-.884 1.303 1.303 1.304-1.303.884.884-1.303 1.303zm6.875-7.866v1.25h-5.625V2.5h1.25z"/></svg>',
      acct:'<svg viewBox="0 0 20 20" aria-hidden="true"><path fill="currentColor" d="M10 2.5c-4.14 0-7.5 3.36-7.5 7.5s3.36 7.5 7.5 7.5 7.5-3.36 7.5-7.5-3.36-7.5-7.5-7.5m0 1.563c.772 0 1.25.478 1.25 1.25 0 .771-.478 1.25-1.25 1.25s-1.25-.479-1.25-1.25c0-.772.478-1.25 1.25-1.25m4.375 4.687h-3.203v1.953l1.64 4.922h-1.48L10 11.635l-1.331 3.99H7.187l1.641-4.922V8.75H5.625V7.5h8.75z"/></svg>'
    };
    function mention(title,url,kind){
      if(!url){var p=document.createElement("span");p.textContent=title;return p;}
      var a=document.createElement("a");a.className="mention "+(kind||"deal");a.href=url;a.target="_blank";a.rel="noopener";
      a.innerHTML=ICONS[kind||"deal"];
      var t=document.createElement("span");t.textContent=title;a.appendChild(t);return a;
    }
    function acctCell(x){var c=document.createElement("td");c.appendChild(mention(x.client,x.clientUrl,"acct"));return c;}
    rows(0);
    var sh=document.getElementById("dshifts");
    if(!DELTAS.shifts.length) empty(sh,"No deals moved in time.");
    else DELTAS.shifts.forEach(function(s){
      var d=document.createElement("div");d.className="dshift";
      var t=mention(s.title,s.url);
      var a=document.createElement("span");a.className="ar "+(s.days<0?"early":"late");a.textContent=(s.days<0?"← ":"→ ")+dur(s.days);
      var c=document.createElement("span");c.className="cl";if(s.client!==s.title)c.appendChild(mention(s.client,s.clientUrl,"acct"));
      d.appendChild(t);d.appendChild(a);d.appendChild(c);sh.appendChild(d);
    });

    function grid(id, head, list, cells, none){
      var t=document.getElementById(id);
      if(!list.length){t.style.display="none";empty(t.parentNode,none);return;}
      var thead=document.createElement("thead"),hr=document.createElement("tr");
      head.forEach(function(h){var th=document.createElement("th");th.textContent=h[0];if(h[1])th.className=h[1];hr.appendChild(th);});
      thead.appendChild(hr);t.appendChild(thead);
      var tb=document.createElement("tbody");list.forEach(function(x){var tr=document.createElement("tr");cells(x).forEach(function(c){tr.appendChild(c);});tb.appendChild(tr);});t.appendChild(tb);
    }
    function clientCell(x){var c=acctCell(x),s=document.createElement("span");s.className="sub";s.appendChild(mention(x.title,x.url));c.appendChild(s);return c;}
    grid("dwins",[["Client"],["Start Date"],["90d Revenue","num"],["Contract Format"]],DELTAS.wins,function(w){return [clientCell(w),td(mdy(w.start)),td(w.rev90>=1e6?"$"+(w.rev90/1e6).toFixed(1)+"M":"$"+Math.round(w.rev90/1e3)+"K","num"),td(w.contract||"—")];},"No new wins since the last snapshot.");
    grid("dlosses",[["Client"],["Reason"]],DELTAS.losses,function(l){return [clientCell(l),td(l.reason||"—")];},"No losses since the last snapshot.");
  })();

  // ---- Coverage glidepath (one per KPI card) ----
  function glide(host,q){
    var W=760,H=371,L=76,R=16,T=24,B=56,pw=W-L-R,ph=H-T-B,YMAX=q.ymax,XMAX=q.xmax,col=q.color,tgt=q.target;
    var x=function(w){return L+(XMAX-w)/XMAX*pw;}, y=function(v){return T+(1-v/YMAX)*ph;};
    var svg=el("svg",{viewBox:"0 0 "+W+" "+H,role:"img","aria-label":q.quarter+" coverage glidepath"});
    for(var gv=0;gv<=YMAX+1;gv+=5e5){svg.appendChild(el("line",{x1:L,x2:W-R,y1:y(gv),y2:y(gv),stroke:"var(--grid)","stroke-width":1}));var t=el("text",{x:L-8,y:y(gv)+6,"text-anchor":"end",fill:"var(--ink-3)","font-size":18,"font-family":'"NB Mono",monospace'});t.textContent=usdS(gv);svg.appendChild(t);}
    svg.appendChild(el("line",{x1:L,x2:W-R,y1:y(tgt),y2:y(tgt),stroke:"var(--ink-2)","stroke-width":1.5,"stroke-dasharray":"6 3"}));
    var tl=el("text",{x:W-R,y:y(tgt)-7,"text-anchor":"end",fill:"var(--ink-2)","font-size":18,"font-family":'"NB Book",sans-serif'});tl.setAttribute("letter-spacing","1px");tl.textContent="TARGET · "+q.tlabel;svg.appendChild(tl);
    for(var w=0;w<=XMAX+.01;w+=(XMAX<=16?2:4)){svg.appendChild(el("line",{x1:x(w),x2:x(w),y1:T,y2:T+ph,stroke:"var(--grid)","stroke-width":1}));var xt=el("text",{x:x(w),y:H-B+24,"text-anchor":"middle",fill:"var(--ink-3)","font-size":18,"font-family":'"NB Mono",monospace'});xt.textContent=w;svg.appendChild(xt);}
    var xl=el("text",{x:L,y:H-B+44,"text-anchor":"start",fill:"var(--ink-3)","font-size":16,"font-family":'"NB Book",sans-serif'});xl.setAttribute("letter-spacing","1px");xl.textContent="◄ WEEKS TO CLOSE";svg.appendChild(xl);
    function path(key){return q.points.map(function(p,i){return (i?"L":"M")+x(p.w).toFixed(1)+" "+y(p[key]*tgt).toFixed(1);}).join(" ");}
    svg.appendChild(el("path",{d:path("c"),fill:"none",stroke:col,"stroke-width":1.6,"stroke-dasharray":"4 3","stroke-opacity":.85,"stroke-linejoin":"round"}));
    svg.appendChild(el("path",{d:path("x"),fill:"none",stroke:col,"stroke-width":2.4,"stroke-linejoin":"round","stroke-linecap":"round"}));
    var last=q.points[q.points.length-1];
    svg.appendChild(el("circle",{cx:x(last.w),cy:y(last.x*tgt),r:4,fill:col,stroke:"var(--surface)","stroke-width":2}));
    var lb=el("text",{x:x(last.w),y:y(last.x*tgt)-11,fill:col,"font-size":19,"font-family":'"NB Mono",monospace',"font-weight":"600","text-anchor":"end"});lb.textContent=usdS(last.x*tgt);svg.appendChild(lb);
    q.points.forEach(function(p){svg.appendChild(el("circle",{cx:x(p.w),cy:y(p.x*tgt),r:2.2,fill:col,"fill-opacity":.55}));});
    // Hover anywhere in the plot: a gentle guide snaps to the nearest snapshot (by weeks to close),
    // marks its closed + weighted points, and shows that snapshot's detail — like the bar chart.
    var guide=el("line",{x1:0,x2:0,y1:T,y2:T+ph,stroke:"var(--ink-3)","stroke-width":1,"stroke-dasharray":"3 3",opacity:0,"pointer-events":"none"});
    var dotC=el("circle",{cx:0,cy:0,r:4.5,fill:"var(--surface)",stroke:col,"stroke-width":2,opacity:0,"pointer-events":"none"});
    var dotX=el("circle",{cx:0,cy:0,r:5,fill:col,stroke:"var(--surface)","stroke-width":2,opacity:0,"pointer-events":"none"});
    // Gap bracket: from the hovered point's Closed (current quarter) or Coverage (next quarter) up/down
    // to the target line, with the signed gap beside it.
    var gapB=el("path",{d:"",fill:"none","stroke-width":2,"stroke-linecap":"round","stroke-linejoin":"round",opacity:0,"pointer-events":"none"});
    var gapT=el("text",{x:0,y:0,"font-size":19,"font-family":'"NB Mono",monospace',"font-weight":"600",opacity:0,"pointer-events":"none"});
    [guide,dotC,dotX,gapB,gapT].forEach(function(n){svg.appendChild(n);});
    function gap(p,px){
      var v=p[q.gapKey]*tgt,d=v-tgt,y1=y(v),y2=y(tgt);
      if(Math.abs(y1-y2)<4){gapB.setAttribute("opacity",0);gapT.setAttribute("opacity",0);return;}
      var right=px+70<W-R,bx=right?px+12:px-12,tk=right?-6:6,c=d<0?"var(--crit-ink)":"var(--good-ink)";
      gapB.setAttribute("d","M"+(bx+tk)+" "+y1+"H"+bx+"V"+y2+"H"+(bx+tk));gapB.setAttribute("stroke",c);gapB.setAttribute("opacity",1);
      gapT.textContent=(d<0?"−":"+")+usdS(Math.abs(d));
      gapT.setAttribute("x",right?bx+8:bx-8);gapT.setAttribute("y",(y1+y2)/2+6);gapT.setAttribute("text-anchor",right?"start":"end");
      gapT.setAttribute("fill",c);gapT.setAttribute("opacity",1);
    }
    function tip(p){return '<div class="tt-h">'+q.quarter+' · '+p.d+'</div>'+row(null,"Weeks out",p.w)+row(col,"Coverage",Math.round(p.c*100)+"% · "+usdS(p.c*tgt))+row(col,"Closed",Math.round(p.x*100)+"% · "+usdS(p.x*tgt))+row(null,"Target",q.tlabel)+row(null,q.gapLabel,(function(d){return (d<0?"−":"+")+usdS(Math.abs(d));})((p[q.gapKey]-1)*tgt));}
    function nearest(ev){
      var pt=svg.createSVGPoint();pt.x=ev.clientX;pt.y=ev.clientY;var sx=pt.matrixTransform(svg.getScreenCTM().inverse()).x;
      var best=q.points[0],bd=Infinity;q.points.forEach(function(p){var d=Math.abs(x(p.w)-sx);if(d<bd){bd=d;best=p;}});return best;
    }
    function mark(ev){
      var p=nearest(ev),px=x(p.w);
      guide.setAttribute("x1",px);guide.setAttribute("x2",px);guide.setAttribute("opacity",1);
      dotC.setAttribute("cx",px);dotC.setAttribute("cy",y(p.c*tgt));dotC.setAttribute("opacity",1);
      dotX.setAttribute("cx",px);dotX.setAttribute("cy",y(p.x*tgt));dotX.setAttribute("opacity",1);
      gap(p,px);
      ttShow(ev,tip(p));
    }
    var hit=el("rect",{x:L,y:T,width:pw,height:ph,fill:"transparent"});hit.style.cursor="crosshair";
    hit.addEventListener("mouseenter",mark);
    hit.addEventListener("mousemove",mark);
    hit.addEventListener("mouseleave",function(){[guide,dotC,dotX,gapB,gapT].forEach(function(n){n.setAttribute("opacity",0);});ttHide();});
    svg.appendChild(hit);
    host.appendChild(svg);
  }
  GLIDE.forEach(function(q){var host=document.getElementById("g-"+q.quarter.replace(/\\./g,"_"));if(host)glide(host,q);});

  // Expand/collapse the KPI cards together — both open or both closed. The Pipeline changes card
  // belongs to that expanded view: it shows under the line charts only while they are open (and
  // always, if there are no line charts to expand).
  var cards=[].slice.call(document.querySelectorAll("details.kpi"));
  var dcard=document.getElementById("dcard");
  function syncDeltas(){if(dcard)dcard.hidden=cards.length>0&&!cards[0].open;}
  cards.forEach(function(d){d.addEventListener("toggle",function(){cards.forEach(function(o){if(o!==d&&o.open!==d.open)o.open=d.open;});syncDeltas();});});
  syncDeltas();
})();
</script>
</body>
</html>`;
}
