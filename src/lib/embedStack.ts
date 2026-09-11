/**
 * Stack several standalone report HTMLs into ONE embed document.
 *
 * Notion renders an uploaded HTML file in a sandboxed iframe that runs inline <script>
 * but strips/blocks nested <iframe> (so srcdoc isolation renders blank). The reports were
 * each authored as an independent page — own :root tokens, generic class names (.card,
 * .legend, .tt…), an id="tt" tooltip — so concatenating them raw collides.
 *
 * So we merge into a single document the same way each report already works in Notion:
 * plain inline <script> (no iframes, no eval), with collisions removed mechanically —
 *   • every selector in a section's CSS is prefixed with a per-section wrapper class,
 *     giving real isolation without a fragile hand-rewrite (":root"/"body" map to the
 *     wrapper; nested @media inside a token rule is preserved);
 *   • the one cross-section id collision (the tooltip #tt) is renamed per section;
 *   • the brand @font-face payload is hoisted out of the sections and emitted once.
 * Each section's IIFE keeps its own scope and finds its own elements by id in the one
 * shared document.
 */

import { BRAND_FONTS } from "./brandFonts.js";

/** Pull the first <style>, first <script>, and the remaining visible markup out of a report doc. */
function parts(html: string): { style: string; script: string; body: string } {
  const style = html.match(/<style[^>]*>([\s\S]*?)<\/style>/i)?.[1] ?? "";
  const script = html.match(/<script[^>]*>([\s\S]*?)<\/script>/i)?.[1] ?? "";
  const body = html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/i, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/i, "")
    .replace(/<!doctype[^>]*>/gi, "")
    .replace(/<\/?(?:html|head|body)[^>]*>/gi, "")
    .replace(/<title[^>]*>[\s\S]*?<\/title>/gi, "")
    .replace(/<(?:link|meta)[^>]*>/gi, "")
    .trim();
  return { style, script, body };
}

/** Prefix one selector with the wrapper; :root/html/body become the wrapper itself. */
function prefixSelector(sel: string, w: string): string {
  const s = sel.trim();
  if (!s) return s;
  if (s === "*") return `${w} *`;
  if (s.includes(":root")) return s.replace(/:root/g, w); // e.g. :root:not([data-theme="light"])
  if (s === "html" || s === "body") return w;
  if (/^(?:html|body)\b/.test(s)) return s.replace(/^(?:html|body)\b/, w);
  return `${w} ${s}`;
}

/** Scope every rule in a stylesheet under `w`, recursing into @media/@supports; @font-face/@keyframes left as-is. */
function scopeRules(css: string, w: string): string {
  let out = "";
  let i = 0;
  const n = css.length;
  while (i < n) {
    let prelude = "";
    while (i < n && css[i] !== "{") prelude += css[i++];
    if (i >= n) { out += prelude; break; }
    let depth = 0;
    let block = "";
    do {
      const ch = css[i++];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      block += ch;
    } while (i < n && depth > 0);
    const head = prelude.trim();
    const inner = block.slice(1, -1); // strip the outer { }
    if (/^@(?:font-face|keyframes|-\w+-keyframes|import|charset)/i.test(head)) {
      out += head + "{" + inner + "}";
    } else if (/^@(?:media|supports)/i.test(head)) {
      out += head + "{" + scopeRules(inner, w) + "}";
    } else {
      // Keep the block verbatim — this preserves CSS-nested @media inside a token rule
      // (e.g. the dark-theme block nested in :root), whose body is declarations, not selectors.
      out += head.split(",").map((sq) => prefixSelector(sq, w)).join(",") + "{" + inner + "}";
    }
  }
  return out;
}

const scopeCss = (css: string, w: string): string => scopeRules(css.replace(/\/\*[\s\S]*?\*\//g, ""), w);

/** One combined embed doc: the given report HTMLs stacked, each isolated, fonts emitted once. */
export function renderStackedEmbed(sections: string[], title: string): string {
  const blocks = sections.map((html, i) => {
    const w = `.s${i}`;
    const p = parts(html);
    const css = scopeCss(p.style.split(BRAND_FONTS).join(""), w); // drop inlined fonts (hoisted below)
    let { body, script } = p;
    if (i > 0) {
      // Disambiguate the single known cross-section id collision (the tooltip).
      body = body.replace(/id="tt"/g, `id="tt${i}"`);
      script = script.replace(/getElementById\("tt"\)/g, `getElementById("tt${i}")`);
    }
    return { i, css, body, script };
  });

  return `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
${BRAND_FONTS}
  /* Theme-aware page background so the gap between sections isn't a white band in dark mode. */
  :root{--pagebg:#FFFFFF}
  @media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--pagebg:#0E1017}}
  :root[data-theme="dark"]{--pagebg:#0E1017}
  html,body{margin:0;padding:0;background:var(--pagebg)}
  [hidden]{display:none!important}
  .rpt{display:block}
  .rpt + .rpt{margin-top:14px}
${blocks.map((b) => b.css).join("\n")}
</style>
${blocks.map((b) => `<div class="rpt s${b.i}">${b.body}</div>`).join("\n")}
${blocks.map((b) => `<script>\n${b.script}\n</script>`).join("\n")}`;
}
