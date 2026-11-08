#!/usr/bin/env node
/**
 * Build the static site from saved gallery runs.
 *
 *   node scripts/build-site.mjs [--gallery <dir>] [--out <dir>] [--hero <file>]
 *
 * Reads every gallery/*.json ({ meta, scorecard }) and:
 *   1. writes <out>/gallery-data.json (the same entries, normalised),
 *   2. renders the hero scorecard and the gallery cards into <out>/index.html
 *      between the <!-- sot:*:start --> / <!-- sot:*:end --> markers
 *      (static HTML: no layout shift, works without JavaScript),
 *   3. writes the README hero image (assets/hero.svg by default) from the
 *      featured run, or an honest "no run yet" layout when there is none,
 *   4. copies assets/logo.svg and assets/social-card.png into <out>,
 *   5. writes the README gallery table between <!-- sot:readme-gallery:* --> markers
 *      (shipped build only, or wherever --readme <file> points).
 *
 * Featured run = the one with "featured": true, else the highest score.
 *
 * Defaults: --gallery gallery/  --out site/  --hero assets/hero.svg.
 * When --out is not site/, site/ is copied there first as the template and the
 * hero image goes to <out>/hero.svg unless --hero is given (so a dev build
 * with fixtures never touches the shipped files).
 *
 * Fails loudly (exit 1) on a malformed gallery file or a verdict that does not
 * match its score band: the gallery shows saved runs only, never a guess.
 */
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = path.join(ROOT, "site");

// ---------- args ----------
function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? path.resolve(process.argv[i + 1]) : null;
}
const galleryDir = arg("gallery") ?? path.join(ROOT, "gallery");
const outDir = arg("out") ?? SITE;
const isDev = path.resolve(outDir) !== path.resolve(SITE);
const heroPath = arg("hero") ?? (isDev ? path.join(outDir, "hero.svg") : path.join(ROOT, "assets", "hero.svg"));

// ---------- rubric (mirror of src/rubric.ts, checked against dist/ when built) ----------
const RUBRIC = [
  { key: "reproducibility", title: "Reproducibility", weight: 0.2, question: "Could an independent party reproduce it, or is it a cherry-picked demo?" },
  { key: "evidence_quality", title: "Evidence quality", weight: 0.2, question: "Real benchmarks and data, or screenshots and vibes?" },
  { key: "scope_honesty", title: "Scope honesty", weight: 0.2, question: "Does it generalize, or is narrow work dressed up as general?" },
  { key: "production_readiness", title: "Production-readiness", weight: 0.15, question: "Demo or deployable: latency, cost, reliability, governance?" },
  { key: "novelty", title: "Novelty", weight: 0.1, question: "Genuine new capability, or a wrapper and a rebrand?" },
  { key: "hidden_caveats", title: "Hidden caveats", weight: 0.15, question: "What is not said: failure modes, constraints, cost?" },
];
const BANDS = { shipsMin: 70, mixedMin: 40 };

async function checkRubricAgainstDist() {
  const dist = path.join(ROOT, "dist", "index.js");
  if (!existsSync(dist)) return "dist/ not built; rubric mirror not cross-checked";
  try {
    const lib = await import(pathToFileURL(dist).href);
    const same =
      lib.RUBRIC?.length === RUBRIC.length &&
      lib.RUBRIC.every((d, i) => d.key === RUBRIC[i].key && d.weight === RUBRIC[i].weight && d.title === RUBRIC[i].title) &&
      lib.VERDICT_BANDS?.shipsMin === BANDS.shipsMin &&
      lib.VERDICT_BANDS?.mixedMin === BANDS.mixedMin;
    if (!same) throw new Error("scripts/build-site.mjs RUBRIC/BANDS differ from dist/ (src/rubric.ts). Update the mirror.");
    return "rubric mirror matches dist/";
  } catch (e) {
    if (String(e.message).includes("differ")) throw e;
    return `rubric not cross-checked (${e.message})`;
  }
}

// ---------- helpers ----------
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDate(s) {
  if (!s) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s));
  if (!m) return String(s);
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

function prettyModel(id) {
  if (!id) return "an unrecorded model";
  const m = /^claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d+))?/i.exec(id);
  if (m) return `Claude ${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? "." + m[3] : ""}`;
  const alias = /^(opus|sonnet|haiku|fable)\b/i.exec(id);
  if (alias) return `Claude ${alias[1][0].toUpperCase()}${alias[1].slice(1)}`;
  return id;
}
const PROVIDERS = { api: "the Anthropic API", "claude-cli": "Claude Code" };

function bandOf(score) {
  if (score === null || score === undefined) return "inconclusive";
  if (score >= BANDS.shipsMin) return "ships";
  if (score >= BANDS.mixedMin) return "mixed";
  return "theater";
}
const VERDICT_LABEL = { ships: "Ships", mixed: "Mixed", theater: "Theater", inconclusive: "Inconclusive" };
const fmtScore = (n) => (n === null || n === undefined ? "–" : Number.isInteger(n) ? String(n) : n.toFixed(1));

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// ---------- load gallery ----------
function loadGallery() {
  if (!existsSync(galleryDir)) return [];
  const files = readdirSync(galleryDir).filter((f) => f.endsWith(".json")).sort();
  const runs = [];
  for (const file of files) {
    const where = path.join(galleryDir, file);
    let raw;
    try {
      raw = JSON.parse(readFileSync(where, "utf8"));
    } catch (e) {
      throw new Error(`${file}: not valid JSON (${e.message})`);
    }
    // Not a saved run (e.g. claims.json, the list of claims to run): skip it.
    if (Array.isArray(raw) || !raw || typeof raw !== "object" || (!("meta" in raw) && !("scorecard" in raw))) {
      skipped.push(file);
      continue;
    }
    const { meta, scorecard: sc } = raw;
    const problems = [];
    if (!meta?.slug) problems.push("meta.slug missing");
    if (!meta?.title) problems.push("meta.title missing");
    if (!sc || !Array.isArray(sc.dimensions)) problems.push("scorecard.dimensions missing");
    if (!["SHIPS", "MIXED", "THEATER", "INCONCLUSIVE"].includes(sc?.verdict)) problems.push(`unknown verdict ${sc?.verdict}`);
    if (sc && sc.overallScore !== null && typeof sc.overallScore !== "number") problems.push("overallScore must be a number or null");
    if (sc && bandOf(sc.overallScore).toUpperCase() !== sc.verdict) problems.push(`verdict ${sc.verdict} does not match score ${sc.overallScore}`);
    if (problems.length) throw new Error(`${file}: ${problems.join("; ")}`);
    const byKey = Object.fromEntries(sc.dimensions.map((d) => [d.dimension, d]));
    const sources = [];
    const seen = new Set();
    for (const s of [meta.sourceUrl, ...(Array.isArray(meta.sources) ? meta.sources : [])]) {
      const url = typeof s === "string" ? s : s?.url;
      if (!url || seen.has(url)) continue;
      seen.add(url);
      sources.push({ url, title: (typeof s === "object" && (s.title || s.label)) || hostOf(url) });
    }
    runs.push({
      meta: { ...meta, sources },
      scorecard: sc,
      band: sc.verdict.toLowerCase(),
      dims: RUBRIC.map((r) => ({ ...r, judged: byKey[r.key] ?? null })),
    });
  }
  return runs;
}
const skipped = [];

// Featured run first (the hero), then highest score (no score last), then newest.
// With no "featured": true the hero is the top-scoring run: the one closest to the Ships bar.
function sortEntries(entries) {
  const num = (e) => (typeof e.scorecard.overallScore === "number" ? e.scorecard.overallScore : -1);
  return [...entries].sort((a, b) => {
    if (Boolean(b.meta.featured) !== Boolean(a.meta.featured)) return b.meta.featured ? 1 : -1;
    if (num(b) !== num(a)) return num(b) - num(a);
    return String(b.meta.runAt ?? "").localeCompare(String(a.meta.runAt ?? ""));
  });
}
const scoredOf = (entries) => entries.filter((e) => typeof e.scorecard.overallScore === "number");
const round1 = (n) => Math.round(n * 10) / 10;

// One factual line under the hero score: rank in the gallery and distance to the Ships line.
function heroNote(e, entries) {
  const s = e.scorecard.overallScore;
  if (typeof s !== "number") return "";
  const scored = scoredOf(entries);
  const parts = [];
  if (scored.length > 1 && scored.every((x) => x.scorecard.overallScore <= s)) parts.push(`Highest of the ${scored.length} gallery runs.`);
  if (s < BANDS.shipsMin) parts.push(`${fmtScore(round1(BANDS.shipsMin - s))} points below the Ships line at ${BANDS.shipsMin}.`);
  return parts.length ? `<p class="sc-note">${parts.join(" ")}</p>` : "";
}

// Gallery summary, computed from the runs: when, verdict counts, and whether anything cleared Ships.
function gallerySummary(entries) {
  const n = entries.length;
  const runs = entries.map((e) => e.meta.runAt).filter(Boolean).sort();
  const first = fmtDate(runs[0]), last = fmtDate(runs.at(-1));
  const when = !runs.length ? "" : first === last ? `, all made ${first}` : `, made ${first} to ${last}`;
  const counts = ["ships", "mixed", "theater", "inconclusive"].map((b) => [b, entries.filter((e) => e.band === b).length]);
  const tally = counts.filter(([, c]) => c).map(([b, c]) => `${c} ${VERDICT_LABEL[b]}`).join(", ");
  const ships = counts[0][1];
  const top = [...scoredOf(entries)].sort((a, b) => b.scorecard.overallScore - a.scorecard.overallScore)[0];
  const bar = ships
    ? ` ${ships} of ${n} reached Ships (${BANDS.shipsMin} or more).`
    : top
      ? ` None reached Ships, which takes ${BANDS.shipsMin} or more. Closest: ${esc(top.meta.title)}, ${fmtScore(top.scorecard.overallScore)}.`
      : "";
  return `<p class="g-sum"><b>${n} run${n === 1 ? "" : "s"}${esc(when)}.</b> ${tally}.${bar}</p>`;
}

// ---------- HTML renderers ----------
function meterHTML(score, { size = "md", labelled = true } = {}) {
  const needle =
    score === null || score === undefined
      ? ""
      : `<span class="meter-needle" style="left:${Math.max(0, Math.min(100, score))}%"></span>`;
  // Small (gallery) bars get the two band numbers under their ticks, so the needle never reads as a third tick.
  const labels = labelled
    ? `<span class="meter-labels" aria-hidden="true"><span>Theater</span><span><b>${BANDS.mixedMin}</b> Mixed</span><span><b>${BANDS.shipsMin}</b> Ships</span></span>`
    : `<span class="meter-nums" aria-hidden="true"><span style="left:${BANDS.mixedMin}%">${BANDS.mixedMin}</span><span style="left:${BANDS.shipsMin}%">${BANDS.shipsMin}</span></span>`;
  // 40 and 70 marks on every meter, so the band edges read even on the small gallery bar.
  const ticks = `<span class="meter-tick" style="left:${BANDS.mixedMin}%"></span><span class="meter-tick" style="left:${BANDS.shipsMin}%"></span>`;
  return `<div class="meter meter-${size}" aria-hidden="true"><span class="meter-track"><span class="seg seg-theater"></span><span class="seg seg-mixed"></span><span class="seg seg-ships"></span>${ticks}${needle}</span>${labels}</div>`;
}

function dimRowsHTML(dims, { reasoning = false } = {}) {
  return dims
    .map(({ title, weight, judged }) => {
      const inc = !judged || judged.inconclusive || judged.score === null;
      const band = inc ? "inconclusive" : bandOf(judged.score);
      const value = inc ? "Inconclusive" : fmtScore(judged.score);
      const why = reasoning && judged?.reasoning ? `<p class="dim-why">${esc(judged.reasoning)}</p>` : "";
      const conf = reasoning && !inc && typeof judged.confidence === "number" ? `<span class="dim-conf">${Math.round(judged.confidence * 100)}% confident</span>` : "";
      return `<li class="dim dim-${band}">
          <span class="dim-name">${esc(title)} <span class="dim-weight">${Math.round(weight * 100)}%</span></span>
          <span class="dim-bar"><span style="width:${inc ? 0 : judged.score}%"></span></span>
          <span class="dim-score">${value}</span>${conf}${why}
        </li>`;
    })
    .join("");
}

function runLine(e) {
  const m = e.meta;
  const via = PROVIDERS[m.provider] ? ` via ${PROVIDERS[m.provider]}` : "";
  const ver = m.toolVersion ? `, ship-or-theater v${esc(m.toolVersion)}` : "";
  return `Run ${esc(fmtDate(m.runAt))} with <span title="${esc(m.model ?? e.scorecard.model)}">${esc(prettyModel(m.model ?? e.scorecard.model))}</span>${esc(via)}${ver}`;
}

function heroCardHTML(e, entries = []) {
  if (!e) {
    return `<article class="sc sc-specimen" aria-label="What a scorecard contains">
      <header class="sc-head"><span class="sc-kicker">Scorecard layout</span><span class="verdict v-inconclusive">No run yet</span></header>
      <p class="sc-claim">Your claim goes here. The tool returns a verdict, a 0–100 reality score and a score per dimension.</p>
      <div class="sc-score"><span class="sc-num">–</span><span class="sc-of">/ 100</span></div>
      ${meterHTML(null)}
      <ol class="dims">${dimRowsHTML(RUBRIC.map((r) => ({ ...r, judged: null }))).replaceAll(">Inconclusive<", ">–<")}</ol>
      <footer class="sc-foot">Real runs appear here as soon as the gallery has one.</footer>
    </article>`;
  }
  const sc = e.scorecard;
  return `<article class="sc" aria-label="Scorecard: ${esc(e.meta.title)}">
      <header class="sc-head"><span class="sc-kicker">${esc(e.meta.claimant ?? "")}</span><span class="verdict v-${e.band}">${VERDICT_LABEL[e.band]}</span></header>
      <p class="sc-claim">“${esc(sc.input?.claim ?? e.meta.title)}”</p>
      <div class="sc-score"><span class="sc-num">${fmtScore(sc.overallScore)}</span><span class="sc-of">/ 100 reality score</span></div>
      ${meterHTML(sc.overallScore)}
      ${heroNote(e, entries)}
      <ol class="dims">${dimRowsHTML(e.dims)}</ol>
      <footer class="sc-foot">${runLine(e)} · <a href="#g-${esc(e.meta.slug)}">Full scorecard</a></footer>
    </article>`;
}

function cardHTML(e) {
  const sc = e.scorecard;
  const m = e.meta;
  const by = [m.claimant ? esc(m.claimant) : "", m.claimDate ? `<span class="nw">claimed ${esc(fmtDate(m.claimDate))}</span>` : ""].filter(Boolean).join(" · ");
  const sources = m.sources.length
    ? `<div class="card-sources"><h4>Sources</h4><ul>${m.sources
        .map((s) => `<li><a href="${esc(s.url)}" rel="noopener" target="_blank">${esc(s.title)}<span class="vh"> (opens in a new tab)</span></a></li>`)
        .join("")}</ul></div>`
    : "";
  return `<article class="card" id="g-${esc(m.slug)}" data-verdict="${e.band}">
      <div class="card-top"><span class="verdict v-${e.band}">${VERDICT_LABEL[e.band]}</span><span class="card-score"><b>${fmtScore(sc.overallScore)}</b><span>/ 100</span></span></div>
      <h3 class="card-title">${esc(m.title)}</h3>
      <p class="card-by">${by}</p>
      ${meterHTML(sc.overallScore, { size: "sm", labelled: false })}
      <details class="card-more">
        <summary><span class="when-closed">Show the full scorecard</span><span class="when-open">Hide the full scorecard</span></summary>
        <div class="card-body">
          <p class="card-claim">“${esc(sc.input?.claim ?? "")}”</p>
          ${sc.summary ? `<p class="card-summary">${esc(sc.summary)}</p>` : ""}
          <ol class="dims dims-full">${dimRowsHTML(e.dims, { reasoning: true })}</ol>
          <div class="sides">
            <div class="side side-for"><h4>Strongest case for</h4><p>${esc(sc.strongestSteelman)}</p></div>
            <div class="side side-against"><h4>Strongest case against</h4><p>${esc(sc.strongestDebunk)}</p></div>
          </div>
          ${sources}
          <p class="card-run">${runLine(e)}</p>
        </div>
      </details>
    </article>`;
}

function galleryHTML(entries) {
  if (!entries.length) {
    return `<div class="empty">
        <h3>No runs published yet.</h3>
        <p>This gallery only shows saved runs of the tool on real public claims, dated and signed with the model that judged them. None has been published yet, and none will be written by hand.</p>
        <p>Run your own in the meantime: <a href="#install">install in 60 seconds</a>.</p>
      </div>`;
  }
  const count = (b) => entries.filter((e) => e.band === b).length;
  const filters = [["all", "All", entries.length], ...["ships", "mixed", "theater", "inconclusive"].map((b) => [b, VERDICT_LABEL[b], count(b)])]
    .filter(([, , n]) => n > 0)
    .map(([key, label, n], i) => `<button type="button" class="chip" data-filter="${key}" aria-pressed="${i === 0}">${label} <span>${n}</span></button>`)
    .join("");
  return `${gallerySummary(entries)}
      <div class="filters" role="group" aria-label="Filter by verdict">${filters}</div>
      <p class="vh" id="filter-status" aria-live="polite"></p>
      <div class="cards">${entries.map(cardHTML).join("")}</div>`;
}

function inject(html, name, content, file = "index.html") {
  const re = new RegExp(`(<!-- sot:${name}:start -->)[\\s\\S]*?(<!-- sot:${name}:end -->)`);
  if (!re.test(html)) throw new Error(`${file} is missing the sot:${name} markers`);
  return html.replace(re, (_, a, b) => `${a}\n${content}\n${b}`);
}

// ---------- README gallery table (values copied from the JSON, never retyped) ----------
const mdCell = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
function listPhrase(items) {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}
function readmeGallery(entries) {
  if (!entries.length) return "No runs published yet. They appear here, and on the website, once `gallery/` has one.";
  const rows = entries.map((e) => {
    const m = e.meta, sc = e.scorecard;
    const title = existsSync(path.join(galleryDir, `${m.slug}.md`)) ? `[${mdCell(m.title)}](gallery/${m.slug}.md)` : mdCell(m.title);
    return `| ${title} | ${mdCell(m.claimant)} | ${sc.verdict} | ${sc.overallScore === null ? "–" : sc.overallScore} |`;
  });
  const days = [...new Set(entries.map((e) => fmtDate(e.meta.runAt)).filter(Boolean))];
  const providers = [...new Set(entries.map((e) => e.meta.provider).filter(Boolean))].map((p) => (p === "claude-cli" ? "the `claude-cli` provider (the local `claude` CLI)" : `the \`${p}\` provider`));
  const models = [...new Set(entries.map((e) => e.meta.model).filter(Boolean))].map((x) => `\`${x}\``);
  const how = [
    days.length ? `on ${listPhrase(days)}` : "",
    providers.length ? `with ${listPhrase(providers)}` : "",
    models.length
      ? `and the model ${entries.every((e) => /^(opus|sonnet|haiku|fable)$/i.test(e.meta.model ?? "")) ? "alias" : "setting"}${models.length > 1 ? "es" : ""} ${listPhrase(models)}`
      : "",
  ].filter(Boolean).join(" ");
  const ships = entries.filter((e) => e.band === "ships").length;
  const bar = ships ? `${ships} of ${entries.length} reached SHIPS (${BANDS.shipsMin} or more).` : `None reached SHIPS, which takes ${BANDS.shipsMin} or more.`;
  return [
    `| Claim | Claimant | Verdict | Score |`,
    `| --- | --- | --- | ---: |`,
    ...rows,
    "",
    `${entries.length === 1 ? "The run was" : `All ${entries.length} runs were`} made ${how}. ${bar}`,
  ].join("\n");
}

// ---------- hero SVG for the README ----------
function heroSVG(e) {
  const W = 1200, H = 600;
  const C = { ships: "#0f7a46", mixed: "#9a5b00", theater: "#b4232a", inconclusive: "#5b6170" };
  const CD = { ships: "#4cc98a", mixed: "#f0b14a", theater: "#ff6b66", inconclusive: "#9aa1b0" };
  const sc = e?.scorecard;
  const band = e ? e.band : "inconclusive";
  const score = sc ? sc.overallScore : null;
  const title = e ? e.meta.title : "No published run yet";
  const sub = e ? `${e.meta.claimant ?? ""}${e.meta.claimDate ? " · claimed " + fmtDate(e.meta.claimDate) : ""}` : "Filled in from the first published gallery run.";
  const foot = e ? runLine(e).replace(/<[^>]+>/g, "") : "Scorecard layout · weights shown, no scores";
  const wrap = (t, n) => {
    const words = String(t).split(/\s+/), lines = [];
    let cur = "";
    for (const w of words) {
      if ((cur + " " + w).trim().length > n && cur) { lines.push(cur); cur = w; } else cur = (cur + " " + w).trim();
    }
    if (cur) lines.push(cur);
    return lines.slice(0, 3);
  };
  const titleLines = wrap(title, 30);
  // Layout: equal top and bottom margins (~64px). The left column has a top group (verdict, score)
  // and a bottom group anchored to the footer (title, claimant, threshold bar), so the bar always
  // sits just under the claimant line whatever the title length.
  const TOP = 82, FOOT = 536;
  const barY = 447, subY = barY - 40, titleY0 = subY - 34 - (titleLines.length - 1) * 30;
  const dims = (e ? e.dims : RUBRIC.map((r) => ({ ...r, judged: null }))).map((d, i) => {
    const inc = !d.judged || d.judged.inconclusive || d.judged.score === null;
    // Rows run from y=152 to the last bar at y=526-534, level with the left column's footer line (536).
    const y = TOP + 70 + i * 72;
    const b = inc ? "inconclusive" : bandOf(d.judged.score);
    const w = inc ? 0 : (d.judged.score / 100) * 360;
    const val = !e ? "–" : inc ? "Inconclusive" : fmtScore(d.judged.score);
    return `<text x="700" y="${y}" class="t dim">${esc(d.title)} <tspan class="muted wt">${Math.round(d.weight * 100)}%</tspan></text>
    <text x="1100" y="${y}" class="t val" text-anchor="end">${esc(val)}</text>
    <rect x="700" y="${y + 14}" width="400" height="8" rx="4" class="track"/>
    ${w ? `<rect x="700" y="${y + 14}" width="${(w / 360) * 400}" height="8" rx="4" class="f-${b}"/>` : ""}`;
  }).join("\n    ");
  const needle = score === null || score === undefined ? "" : `<rect x="${80 + (score / 100) * 520 - 1.5}" y="${barY - 8}" width="3" height="28" class="ink"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="ship-or-theater scorecard: ${esc(title)}${e ? ", " + VERDICT_LABEL[band] + " " + fmtScore(score) + " of 100" : ""}">
  <style>
    .bg{fill:#ffffff}.rule{fill:#e2e0d9}.track{fill:#ecebe6}.ink{fill:#14161b}
    .t{font-family:Inter,'Segoe UI',-apple-system,Helvetica,Arial,sans-serif;fill:#14161b}
    .serif{font-family:Newsreader,Georgia,'Times New Roman',serif}.num{font-variant-numeric:lining-nums}
    .muted{fill:#5b6170}.dim{font-size:20px;font-weight:600}.val{font-size:20px;font-weight:600}.wt{font-size:16px;font-weight:500}.tick{fill:#8a8f99}
    .f-ships{fill:${C.ships}}.f-mixed{fill:${C.mixed}}.f-theater{fill:${C.theater}}.f-inconclusive{fill:${C.inconclusive}}
    .s-theater{fill:${C.theater};opacity:.22}.s-mixed{fill:${C.mixed};opacity:.26}.s-ships{fill:${C.ships};opacity:.22}
    .v{fill:${C[band]}}
    @media (prefers-color-scheme: dark){
      .bg{fill:#12151c}.rule{fill:#252a35}.track{fill:#232834}.ink{fill:#eceef3}.t{fill:#eceef3}.muted{fill:#a3a9b6}
      .f-ships{fill:${CD.ships}}.f-mixed{fill:${CD.mixed}}.f-theater{fill:${CD.theater}}.f-inconclusive{fill:${CD.inconclusive}}
      .s-theater{fill:${CD.theater}}.s-mixed{fill:${CD.mixed}}.s-ships{fill:${CD.ships}}.v{fill:${CD[band]}}
    }
  </style>
  <rect class="bg" width="${W}" height="${H}" rx="20"/>
  <rect class="rule" x="640" y="${TOP - 22}" width="1" height="${FOOT + 4 - (TOP - 22)}"/>
  <text x="80" y="${TOP}" class="t v" font-size="20" font-weight="700" letter-spacing="2">${esc(e ? VERDICT_LABEL[band].toUpperCase() : "NO RUN YET")}</text>
  <text x="80" y="${TOP + 132}" class="t serif num" font-size="140" font-weight="600" letter-spacing="-4">${esc(e ? fmtScore(score) : "?")}</text>
  <text x="80" y="${TOP + 176}" class="t muted" font-size="20">/ 100 reality score</text>
  ${titleLines.map((l, i) => `<text x="80" y="${titleY0 + i * 30}" class="t" font-size="24" font-weight="600">${esc(l)}</text>`).join("\n  ")}
  <text x="80" y="${subY}" class="t muted" font-size="17">${esc(sub.slice(0, 64))}</text>
  <rect x="80" y="${barY}" width="208" height="12" class="s-theater"/><rect x="288" y="${barY}" width="156" height="12" class="s-mixed"/><rect x="444" y="${barY}" width="156" height="12" class="s-ships"/>
  <rect x="287" y="${barY - 6}" width="2" height="24" class="tick"/><rect x="443" y="${barY - 6}" width="2" height="24" class="tick"/>
  ${needle}
  <text x="80" y="${barY + 42}" class="t muted" font-size="15">Theater</text><text x="296" y="${barY + 42}" class="t muted" font-size="15"><tspan font-weight="700">40</tspan> Mixed</text><text x="452" y="${barY + 42}" class="t muted" font-size="15"><tspan font-weight="700">70</tspan> Ships</text>
  <text x="700" y="${TOP}" class="t" font-size="20" font-weight="700">Six dimensions, fixed weights</text>
    ${dims}
  <text x="80" y="${FOOT}" class="t muted" font-size="15">${esc(foot.slice(0, 120))}</text>
</svg>
`;
}

// ---------- main ----------
const rubricNote = await checkRubricAgainstDist();
const entries = sortEntries(loadGallery());

mkdirSync(outDir, { recursive: true });
if (isDev) cpSync(SITE, outDir, { recursive: true });

const indexPath = path.join(outDir, "index.html");
let html = readFileSync(indexPath, "utf8");
html = inject(html, "hero", heroCardHTML(entries[0], entries));
html = inject(html, "gallery", galleryHTML(entries));
writeFileSync(indexPath, html);

// README gallery table: shipped build only (a dev build must not touch README.md) unless --readme is given.
const readmePath = arg("readme") ?? (isDev ? null : path.join(ROOT, "README.md"));
if (readmePath) writeFileSync(readmePath, inject(readFileSync(readmePath, "utf8"), "readme-gallery", readmeGallery(entries), path.basename(readmePath)));

writeFileSync(
  path.join(outDir, "gallery-data.json"),
  JSON.stringify({ rubric: RUBRIC, bands: BANDS, entries: entries.map(({ meta, scorecard }) => ({ meta, scorecard })) }, null, 2) + "\n",
);

mkdirSync(path.dirname(heroPath), { recursive: true });
writeFileSync(heroPath, heroSVG(entries[0]));

for (const f of ["logo.svg", "social-card.png"]) {
  const src = path.join(ROOT, "assets", f);
  if (existsSync(src)) copyFileSync(src, path.join(outDir, f));
}

console.log(
  `build-site: ${entries.length} gallery run(s) from ${path.relative(ROOT, galleryDir) || galleryDir}` +
    `${entries.length ? "" : " (empty state)"}${skipped.length ? `; skipped non-run file(s): ${skipped.join(", ")}` : ""}` +
    ` -> ${outDir}; hero -> ${heroPath}${readmePath ? `; readme -> ${readmePath}` : ""}; ${rubricNote}`,
);
