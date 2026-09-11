/**
 * Pipeline Coverage Funnel embed: open pipeline by stage (probability tier) measured against
 * a per-stage "ideal minimum", split existing-client vs net-new, with committed Won as the base
 * and a weighted-vs-target gauge. Three models (single-stage / distributed / actual) chosen in
 * the browser; Distributed is the default. Generated from the prototype; data injected at render.
 */

import type { FunnelWindow } from "./coverageFunnel.js";
import { BRAND_FONTS } from "./brandFonts.js";

export function renderFunnelHtml(windows: FunnelWindow[], meta: { asOf: string }): string {
  const obj: Record<string, unknown> = {};
  for (const w of windows) obj[w.key] = { label: w.label, target: w.target, won: w.won, wex: w.wex, wonN: w.wonN, g: w.g, ex: w.ex, n: w.n };
  const firstKey = windows[0]?.key ?? "";
  return `<title>Pipeline Coverage Funnel</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<style>
${BRAND_FONTS}
  :root{
    --surface:#FFFFFF; --panel:#F8F9FC; --panel-2:#F1F3F9; --ink:#1E293B; --ink-2:#5B6472; --ink-3:#94A3B8;
    --hair:#E4E8F0; --hair-strong:#CBD5E1; --track:#EEF1F6;
    --base:#2424FC; --good:#046904; --crit:#B02525;
    --mag-l:#EAD1DC; --mag-m:#C27BA0; --mag-d:#A64D79; --pur-l:#D9D2E9; --pur-m:#8E7CC3; --pur-d:#674EA7;
    --blu-l:#CFE2F3; --blu-m:#6FA8DC; --blu-d:#3D85C6; --grn-l:#D8EAD3; --grn-m:#93C47D; --grn-d:#6AA84F;
    --font:"NB International Pro","Helvetica Neue",Arial,sans-serif; --book:"NB Book","Helvetica Neue",Arial,sans-serif; --mono:"NB Mono","SFMono-Regular",Menlo,monospace;
  }
  :root:not([data-theme="light"]){@media (prefers-color-scheme:dark){
    --surface:#0E1017; --panel:#161922; --panel-2:#1C212C; --ink:#E7EAF1; --ink-2:#A6AEBE; --ink-3:#6B7688;
    --hair:#242938; --hair-strong:#333B4D; --track:#1C212C; --base:#8A8AFF; --good:#5FD08A; --crit:#F0857A;
  }}
  :root[data-theme="dark"]{
    --surface:#0E1017; --panel:#161922; --panel-2:#1C212C; --ink:#E7EAF1; --ink-2:#A6AEBE; --ink-3:#6B7688;
    --hair:#242938; --hair-strong:#333B4D; --track:#1C212C; --base:#8A8AFF; --good:#5FD08A; --crit:#F0857A;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--surface);color:var(--ink);font-family:var(--font);-webkit-font-smoothing:antialiased}
  .wrap{max-width:960px;margin:0 auto;padding:22px 20px 30px}
  h1{font-family:var(--book);font-weight:400;color:var(--base);font-size:clamp(1.4rem,3vw,2rem);line-height:1.1;letter-spacing:-.02em;margin:0;text-wrap:balance}
  .rule{border:0;border-top:1px solid var(--hair);margin:16px 0}
  .controls{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:8px}
  .clabel{font-size:12.5px;color:var(--ink-3)}
  .seg{display:inline-flex;border:1px solid var(--hair-strong);border-radius:20px;overflow:hidden}
  .seg button{appearance:none;border:0;background:transparent;color:var(--ink-2);font-family:var(--book);font-size:12.5px;padding:6px 14px;cursor:pointer}
  .seg button.on{background:var(--base);color:#fff}
  .asof{margin-left:auto;font-size:12px;color:var(--ink-3)}
  .stats{display:flex;gap:24px;flex-wrap:wrap;align-items:baseline;margin:14px 0 4px}
  .stat .n{font-family:var(--mono);font-size:23px;letter-spacing:-.5px;font-variant-numeric:tabular-nums}
  .stat .k{display:block;font-family:var(--book);text-transform:uppercase;letter-spacing:1.1px;font-size:9px;color:var(--ink-3);margin-top:5px}
  .cov .n{color:var(--base)} .gap .n{color:var(--crit)} .gap.ok .n{color:var(--good)} .won .n{color:var(--grn-d)}
  .grid{display:grid;grid-template-columns:1fr 150px;gap:22px;align-items:stretch;margin-top:12px}
  @media(max-width:620px){.grid{grid-template-columns:1fr}}
  .card{border:1px solid var(--hair);border-radius:8px;background:var(--panel);padding:16px 18px}
  .card h2{font-family:var(--book);font-weight:400;font-size:12px;text-transform:uppercase;letter-spacing:1.4px;color:var(--ink-3);margin:0 0 4px}
  .card .h2sub{font-size:11px;color:var(--ink-3);margin:0 0 12px;line-height:1.5}
  .frow{display:grid;grid-template-columns:34px 1fr;gap:10px;align-items:center;margin:8px 0}
  .flabel{font-family:var(--mono);font-size:12px;color:var(--ink-2);text-align:right}
  .barwrap{display:flex;flex-direction:column;align-items:flex-start}
  .bar{position:relative;height:24px;border-radius:4px;min-width:6px;overflow:hidden;transition:width .25s ease}
  .bar .fseg{position:absolute;top:0;bottom:0;border:0;transition:width .25s ease,left .25s ease}
  .bar .fseg.exp{left:0}
  .bar .pct{position:absolute;top:50%;transform:translateY(-50%);right:7px;font-family:var(--mono);font-size:10px;color:var(--ink-3)}
  .bmeta{font-family:var(--mono);font-size:10.5px;color:var(--ink-3);margin-top:3px;white-space:nowrap}
  .bmeta b{color:var(--ink);font-weight:600}
  .won-base{margin-top:6px;border-top:1px dashed var(--hair);padding-top:8px}
  .gaugewrap{display:flex;flex-direction:column}
  .gauge{position:relative;flex:1;min-height:300px;border:1px solid var(--hair);border-radius:8px;background:var(--track);overflow:hidden;display:flex;flex-direction:column-reverse}
  .gseg{width:100%;transition:height .25s ease}
  .gtarget{position:absolute;left:0;right:0;top:0;border-top:2px dashed var(--ink-2)}
  .gtarget span{position:absolute;right:6px;top:4px;font-family:var(--book);font-size:9px;letter-spacing:1px;color:var(--ink-2)}
  .gcov{position:absolute;left:0;right:0;text-align:center;font-family:var(--mono);font-size:13px;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.4)}
  .legend{display:flex;gap:16px;flex-wrap:wrap;font-size:11px;color:var(--ink-2);margin-top:14px}
  .legend span{display:flex;align-items:center;gap:6px}
  .sw{width:34px;height:12px;border-radius:3px;flex:0 0 auto;position:relative;background:var(--pur-l);overflow:hidden}
  .sw .e{position:absolute;top:0;bottom:0;left:0;width:38%;background:var(--pur-d)}
  .sw .n{position:absolute;top:0;bottom:0;left:38%;width:28%;background:repeating-linear-gradient(45deg,var(--pur-m) 0 2px,var(--pur-d) 2px 4px)}
  .foot{margin-top:16px;font-size:11px;color:var(--ink-3);line-height:1.6;max-width:82ch}
  .tt{position:fixed;z-index:50;pointer-events:none;opacity:0;transition:opacity .1s;background:var(--surface);border:1px solid var(--hair-strong);border-radius:6px;box-shadow:0 8px 26px rgba(15,23,42,.18);padding:9px 12px;font-size:12px;min-width:184px}
  .tt.on{opacity:1}
  .tt .h{font-family:var(--book);text-transform:uppercase;letter-spacing:1.2px;font-size:10px;color:var(--ink-3);margin-bottom:6px}
  .tt .r{display:flex;justify-content:space-between;gap:16px;line-height:1.75}
  .tt .r .v{font-family:var(--mono);color:var(--ink)}
  .tt .r.sub{color:var(--ink-2);font-size:11px}
  .tt .r.sub .lbl{display:flex;align-items:center;gap:6px}
  .tt .r.sub .lbl i{width:7px;height:7px;border-radius:2px;flex:0 0 auto}
</style>

<div class="wrap">
  <h1>Is our pipeline enough to hit the target?</h1>
  <hr class="rule">

  <div class="controls">
    <span class="clabel">Through:</span>
    <div class="seg" id="segWin"></div>
    <span class="clabel" style="margin-left:8px">Model:</span>
    <div class="seg" id="segMode"></div>
    <span class="asof" id="asof"></span>
  </div>

  <div class="stats">
    <div class="stat won"><span class="n" id="sWon"></span><span class="k">Committed (Won)</span></div>
    <div class="stat cov"><span class="n" id="sCov"></span><span class="k">Weighted coverage</span></div>
    <div class="stat"><span class="n" id="sTarget"></span><span class="k">Target</span></div>
    <div class="stat gap" id="sGapWrap"><span class="n" id="sGap"></span><span class="k" id="sGapK">Weighted Gap</span></div>
  </div>

  <div class="grid">
    <div class="card">
      <h2 id="ftitle">Coverage funnel</h2>
      <div class="h2sub" id="fsub"></div>
      <div id="funnel"></div>
      <div class="won-base" id="wonbase"></div>
    </div>
    <div class="card gaugewrap">
      <h2>Weighted vs target</h2>
      <div class="gauge" id="gauge"></div>
    </div>
  </div>

  <div class="legend">
    <span><i class="sw"><i class="e"></i><i class="n"></i></i> <span id="legtext"></span></span>
  </div>
  <p class="foot" id="ffoot"></p>
</div>
<div class="tt" id="tt"></div>

<script>
  var STAGES=[
    {p:10,cl:"--mag-l",cm:"--mag-m",cd:"--mag-d"},
    {p:20,cl:"--pur-l",cm:"--pur-m",cd:"--pur-d"},
    {p:40,cl:"--pur-l",cm:"--pur-m",cd:"--pur-d"},
    {p:60,cl:"--blu-l",cm:"--blu-m",cd:"--blu-d"},
    {p:80,cl:"--grn-l",cm:"--grn-m",cd:"--grn-d"}
  ];
  var WINDOWS=${JSON.stringify(obj)};
  var MODES={
    "Single-stage":{title:"Single-stage stress test", light:"Ideal Minimum"},
    "Distributed":{title:"Distributed ideal", light:"Ideal Minimum"},
    "Actual":{title:"Actual coverage by stage", light:"Gross pipeline"}
  };
  var cur=${JSON.stringify(firstKey)}, mode="Distributed", ASOF=${JSON.stringify(meta.asOf)};
  function usd(n){var a=Math.abs(n);return a>=1e6?"$"+(n/1e6).toFixed(1)+"M":a>=1e3?"$"+Math.round(n/1e3)+"K":"$"+Math.round(n);}
  var TT=document.getElementById("tt");
  function tip(ev,html){TT.innerHTML=html;TT.classList.add("on");var p=14,ww=TT.offsetWidth,hh=TT.offsetHeight,x=ev.clientX+p,y=ev.clientY+p;if(x+ww>innerWidth)x=ev.clientX-ww-p;if(y+hh>innerHeight)y=ev.clientY-hh-p;TT.style.left=x+"px";TT.style.top=y+"px";}
  function tipOff(){TT.classList.remove("on");}
  function stripe(cd,cl){return "repeating-linear-gradient(45deg,var("+cd+") 0 3px,var("+cl+") 3px 6px)";}

  function render(){
    var w=WINDOWS[cur]; if(!w)return; var gap=Math.max(0,w.target-w.won);
    var wtd=w.won, exSum=0,nnSum=0;
    STAGES.forEach(function(s){var g=w.g[s.p]||0,ex=w.ex[s.p]||0;wtd+=g*s.p/100;exSum+=ex;nnSum+=(g-ex);});
    var covPct=w.target?wtd/w.target:0, gapToTgt=Math.max(0,w.target-wtd);

    document.getElementById("asof").textContent="as of "+ASOF;
    document.getElementById("sTarget").textContent=usd(w.target);
    document.getElementById("sWon").textContent=usd(w.won);
    document.getElementById("sCov").textContent=usd(wtd)+"  ·  "+Math.round(covPct*100)+"%";
    var gw=document.getElementById("sGapWrap");
    document.getElementById("sGap").textContent=(gapToTgt>0?"−":"+")+usd(gapToTgt>0?gapToTgt:(wtd-w.target));
    document.getElementById("sGapK").textContent=gapToTgt>0?"Weighted Gap":"Over target";
    gw.classList.toggle("ok",gapToTgt<=0);

    var shown = mode==="Single-stage" ? STAGES.filter(function(s){return s.p>=40;}) : STAGES.slice();
    var sumFrac = shown.reduce(function(a,s){return a+s.p/100;},0);
    var bands = shown.map(function(s){
      var g=w.g[s.p]||0, ex=w.ex[s.p]||0, nn=g-ex, pf=s.p/100, light, fillFrac, ideal=null, wtdStage=g*pf;
      if(mode==="Actual"){ light=g; fillFrac=pf; }
      else { ideal = mode==="Single-stage" ? gap/pf : gap/sumFrac; light=ideal; fillFrac=ideal?Math.min(g/ideal,1):0; }
      return {s:s,g:g,ex:ex,nn:nn,pf:pf,light:light,fillFrac:fillFrac,ideal:ideal,wtdStage:wtdStage,deals:w.n[s.p]||0};
    });
    var maxScale=Math.max.apply(null, bands.map(function(b){return b.light;}).concat([w.won,1]));

    var f=document.getElementById("funnel"); f.innerHTML="";
    bands.forEach(function(b){
      var barW=maxScale?Math.max(6,Math.sqrt(b.light/maxScale)*100):0;
      var exW=b.g?b.fillFrac*(b.ex/b.g)*100:0, nnW=b.g?b.fillFrac*(b.nn/b.g)*100:0;
      var pct = mode==="Actual" ? (gap?Math.round(b.wtdStage/gap*100):0)+"%" : Math.round(b.fillFrac*100)+"%";
      var meta = mode==="Actual"
        ? 'weighted <b>'+usd(b.wtdStage)+'</b> · gross '+usd(b.g)+' · '+b.deals+' deals'
        : '<b>'+usd(b.g)+'</b> of '+usd(b.ideal)+' · '+b.deals+' deals';
      var row=document.createElement("div"); row.className="frow";
      row.innerHTML='<div class="flabel">'+b.s.p+'%</div>'+
        '<div class="barwrap"><div class="bar" style="width:'+barW+'%;background:var('+b.s.cl+')">'+
        '<div class="fseg exp" style="width:'+exW+'%;background:var('+b.s.cd+')"></div>'+
        '<div class="fseg" style="left:'+exW+'%;width:'+nnW+'%;background:'+stripe(b.s.cm,b.s.cd)+'"></div>'+
        '<span class="pct">'+pct+'</span></div>'+
        '<div class="bmeta">'+meta+'</div></div>';
      row.style.cursor="crosshair";
      var extra = mode==="Actual"
        ? '<div class="r"><span>Weighted (expected)</span><span class="v">'+usd(b.wtdStage)+'</span></div><div class="r"><span>Covers of gap</span><span class="v">'+(gap?Math.round(b.wtdStage/gap*100):0)+'%</span></div>'
        : '<div class="r"><span>Ideal minimum</span><span class="v">'+usd(b.ideal)+'</span></div><div class="r"><span>Stocked</span><span class="v">'+Math.round(b.fillFrac*100)+'%</span></div>';
      var html='<div class="h">'+b.s.p+'% stage</div>'+
        '<div class="r"><span>Pipeline (gross)</span><span class="v">'+usd(b.g)+'</span></div>'+
        '<div class="r sub"><span class="lbl"><i style="background:var('+b.s.cd+')"></i>Existing clients</span><span class="v">'+usd(b.ex)+'</span></div>'+
        '<div class="r sub"><span class="lbl"><i style="background:'+stripe(b.s.cm,b.s.cd)+'"></i>New clients</span><span class="v">'+usd(b.nn)+'</span></div>'+
        extra+'<div class="r"><span>Deals</span><span class="v">'+b.deals+'</span></div>';
      (function(h){row.addEventListener("mouseenter",function(e){tip(e,h);});row.addEventListener("mousemove",function(e){tip(e,h);});row.addEventListener("mouseleave",tipOff);})(html);
      f.appendChild(row);
    });

    var wex=w.wex||0, wnn=w.won-wex, wbarW=maxScale?Math.max(6,Math.sqrt(w.won/maxScale)*100):0;
    var wexW=w.won?wex/w.won*100:0, wnnW=w.won?wnn/w.won*100:0;
    var wb=document.getElementById("wonbase");
    wb.innerHTML='<div class="frow"><div class="flabel" style="color:var(--grn-d);font-weight:600">Won</div>'+
      '<div class="barwrap"><div class="bar" style="width:'+wbarW+'%;background:var(--grn-l)">'+
      '<div class="fseg exp" style="width:'+wexW+'%;background:var(--grn-d)"></div>'+
      '<div class="fseg" style="left:'+wexW+'%;width:'+wnnW+'%;background:'+stripe("--grn-m","--grn-d")+'"></div></div>'+
      '</div></div>';
    var wonRow=wb.querySelector(".frow"); wonRow.style.cursor="crosshair";
    var wonHtml='<div class="h">Won · committed</div><div class="r"><span>Banked</span><span class="v">'+usd(w.won)+'</span></div>'+
      '<div class="r sub"><span class="lbl"><i style="background:var(--grn-d)"></i>Existing clients</span><span class="v">'+usd(wex)+'</span></div>'+
      '<div class="r sub"><span class="lbl"><i style="background:'+stripe("--grn-m","--grn-d")+'"></i>New clients</span><span class="v">'+usd(wnn)+'</span></div>'+
      '<div class="r"><span>Deals</span><span class="v">'+(w.wonN||0)+'</span></div>';
    wonRow.addEventListener("mouseenter",function(e){tip(e,wonHtml);}); wonRow.addEventListener("mousemove",function(e){tip(e,wonHtml);}); wonRow.addEventListener("mouseleave",tipOff);

    var g2=document.getElementById("gauge"); g2.innerHTML="";
    var order=[{v:w.won,cd:"--grn-d"}];
    [80,60,40,20,10].forEach(function(p){var s=STAGES.filter(function(x){return x.p===p;})[0];order.push({v:(w.g[p]||0)*p/100,cd:s.cd});});
    order.forEach(function(seg){ if(seg.v<=0)return; var d=document.createElement("div"); d.className="gseg"; d.style.height=(w.target?seg.v/w.target*100:0)+"%"; d.style.background="var("+seg.cd+")"; g2.appendChild(d); });
    var tgt=document.createElement("div"); tgt.className="gtarget"; tgt.innerHTML='<span>TARGET '+usd(w.target)+'</span>'; g2.appendChild(tgt);
    var cl=document.createElement("div"); cl.className="gcov"; cl.style.bottom="calc("+Math.min(covPct*100,94)+"% - 18px)"; cl.textContent=Math.round(covPct*100)+"%"; g2.appendChild(cl);

    document.getElementById("ftitle").textContent=MODES[mode].title;
    document.getElementById("legtext").innerHTML="Solid = Existing clients · Striped = New Clients · Light = "+MODES[mode].light;
    var idealFlat = sumFrac?gap/sumFrac:0;
    if(mode==="Single-stage"){
      document.getElementById("fsub").innerHTML="Gap above committed <b style='color:var(--ink)'>"+usd(gap)+"</b> · a stress test: could this one stage rescue the quarter? Bands don't add up.";
      document.getElementById("ffoot").textContent="Single-stage stress test. Each band answers “if only this stage's deals closed, how much would I need?” — useful for 60/80% (are near-close deals enough?), noise below. Not additive. Win-rates are CRM stage probabilities, not calibrated. √-compressed widths; exact figures on hover.";
    } else if(mode==="Distributed"){
      document.getElementById("fsub").innerHTML="Gap above committed <b style='color:var(--ink)'>"+usd(gap)+"</b> · ideal ≈ "+usd(idealFlat)+" per stage; together they cover the gap.";
      document.getElementById("ffoot").textContent="Distributed ideal. Assumes each stage should hold roughly equal pipeline (so higher-probability stages carry more of the weighted coverage). Additive and intuitive, but the even-split is a policy choice. Win-rates are CRM stage probabilities. √-compressed widths; exact figures on hover.";
    } else {
      document.getElementById("fsub").innerHTML="Gap above committed <b style='color:var(--ink)'>"+usd(gap)+"</b> · each band's % = how much of the gap that stage's weighted pipeline covers.";
      document.getElementById("ffoot").textContent="Actual coverage, no assumptions. Light = gross pipeline, fill = weighted (expected) by stage; the % is that stage's share of the gap. Aggregate coverage is the gauge ("+Math.round(covPct*100)+"%). √-compressed widths; exact figures on hover.";
    }
  }

  function mkseg(el,keys,getCur,setCur){
    keys.forEach(function(k){
      var b=document.createElement("button"); b.type="button"; b.textContent=k; if(k===getCur())b.className="on";
      b.addEventListener("click",function(){setCur(k);[].forEach.call(el.children,function(x){x.classList.toggle("on",x.textContent===k);});render();});
      el.appendChild(b);
    });
  }
  mkseg(document.getElementById("segWin"),Object.keys(WINDOWS),function(){return cur;},function(k){cur=k;});
  mkseg(document.getElementById("segMode"),Object.keys(MODES),function(){return mode;},function(k){mode=k;});
  render();
</script>
`;
}
