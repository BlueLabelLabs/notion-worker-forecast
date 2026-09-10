/**
 * Stack several standalone report HTMLs into ONE embed document, each in its own
 * same-origin <iframe srcdoc>. Isolation is the point: the reports were authored as
 * independent full pages (own <style>, :root tokens, class names, scripts, element ids),
 * so concatenating them raw would collide. Nested srcdoc iframes keep each report's CSS
 * and JS fully sandboxed from the other while still rendering in a single Notion block.
 *
 * srcdoc iframes inherit the parent's origin, so the outer doc can measure each inner
 * document and size its iframe to the content (auto-height), refitting on interaction
 * (expand/collapse, toggles) via a ResizeObserver on the inner body.
 */

/** Escape an HTML string for use inside a double-quoted srcdoc="" attribute. */
const forSrcdoc = (html: string) => html.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

/** One combined embed doc: the given report HTMLs stacked, each isolated + auto-sized. */
export function renderStackedEmbed(sections: string[], title: string): string {
  const frames = sections
    .map((html, i) => `<iframe class="rpt" title="section ${i + 1}" style="height:${i === 0 ? 1200 : 900}px" srcdoc="${forSrcdoc(html)}"></iframe>`)
    .join("\n");
  return `<title>${title}</title>
<style>
  html,body{margin:0;padding:0;background:transparent}
  iframe.rpt{display:block;width:100%;border:0;overflow:hidden}
  iframe.rpt + iframe.rpt{margin-top:14px}
</style>
${frames}
<script>
(function(){
  function fit(f){ try{ var d=f.contentWindow.document; f.style.height=Math.max(d.documentElement.scrollHeight, d.body.scrollHeight)+"px"; }catch(e){} }
  document.querySelectorAll("iframe.rpt").forEach(function(f){
    f.addEventListener("load", function(){
      fit(f);
      try{ new f.contentWindow.ResizeObserver(function(){ fit(f); }).observe(f.contentWindow.document.body); }catch(e){}
      [150,500,1200].forEach(function(t){ setTimeout(function(){ fit(f); }, t); }); // late layout / web fonts
    });
  });
})();
</script>`;
}
