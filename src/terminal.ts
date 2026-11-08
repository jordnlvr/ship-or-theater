import type { ProgressEvent } from "./pipeline.js";
import { countUsable, getDimension, RUBRIC, VERDICT_BANDS } from "./rubric.js";
import { VERDICT_GLOSS } from "./scorecard.js";
import type { JudgedDimension, Scorecard, Verdict } from "./types.js";

/**
 * Pure terminal scorecard and rubric renderers, plus TTY progress line formatting.
 * Respects NO_COLOR / --no-color and adapts cleanly down to 60 columns.
 */

export type OutputFormat = "pretty" | "markdown" | "json";

export interface RenderTerminalOptions {
  /** Whether to emit ANSI color/style codes. Defaults to true unless NO_COLOR is set. */
  color?: boolean;
  /** Target terminal width in columns (clamped to >= 60, default 80). */
  width?: number;
}

const ANSI_REGEX = /\x1b\[[0-9;]*[a-zA-Z]/g;

/** Strip ANSI escape sequences from a string. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_REGEX, "");
}

/**
 * Determine whether ANSI colors should be used given CLI flags and environment.
 * Honors https://no-color.org (`NO_COLOR` non-empty disables color) and `--no-color`.
 */
export function shouldUseColor(
  options: {
    colorFlag?: boolean;
    env?: NodeJS.ProcessEnv;
  } = {},
): boolean {
  if (options.colorFlag === false) return false;
  const env = options.env ?? process.env;
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") {
    return false;
  }
  return options.colorFlag ?? true;
}

/**
 * Resolve the output format from `--format`, `--json`, and TTY state.
 * Default is `"pretty"` when stdout is a TTY, otherwise `"markdown"` for back-compat.
 */
export function resolveOutputFormat(options: {
  format?: string;
  json?: boolean;
  isTTY?: boolean;
}): OutputFormat | { error: string } {
  if (options.format !== undefined) {
    const norm = options.format.trim().toLowerCase();
    if (norm === "pretty" || norm === "markdown" || norm === "json") {
      return norm;
    }
    return {
      error: `Invalid format "${options.format}". Expected one of: pretty, markdown, json.`,
    };
  }
  if (options.json) return "json";
  return options.isTTY ? "pretty" : "markdown";
}

interface Palette {
  bold: (s: string) => string;
  dim: (s: string) => string;
  green: (s: string) => string;
  amber: (s: string) => string;
  red: (s: string) => string;
  grey: (s: string) => string;
  cyan: (s: string) => string;
  badge: (verdict: Verdict) => string;
  scoreColor: (score: number | null) => (s: string) => string;
}

function makePalette(useColor: boolean): Palette {
  const wrap = (open: string, close = "\x1b[0m") =>
    useColor ? (s: string) => `${open}${s}${close}` : (s: string) => s;

  const bold = wrap("\x1b[1m");
  const dim = wrap("\x1b[2m");
  const green = wrap("\x1b[32m");
  const amber = wrap("\x1b[33m");
  const red = wrap("\x1b[31m");
  const grey = wrap("\x1b[90m");
  const cyan = wrap("\x1b[36m");

  const badge = (verdict: Verdict): string => {
    const label = ` ${verdict} `;
    if (!useColor) return `[${verdict}]`;
    switch (verdict) {
      case "SHIPS":
        return `\x1b[42;30;1m${label}\x1b[0m`;
      case "MIXED":
        return `\x1b[43;30;1m${label}\x1b[0m`;
      case "THEATER":
        return `\x1b[41;37;1m${label}\x1b[0m`;
      case "INCONCLUSIVE":
        return `\x1b[100;37;1m${label}\x1b[0m`;
    }
  };

  const scoreColor = (score: number | null): ((s: string) => string) => {
    if (score === null) return grey;
    if (score >= VERDICT_BANDS.shipsMin) return green;
    if (score >= VERDICT_BANDS.mixedMin) return amber;
    return red;
  };

  return { bold, dim, green, amber, red, grey, cyan, badge, scoreColor };
}

/** Wrap plain text into lines that each fit within `maxWidth` columns. */
export function wrapText(
  text: string,
  maxWidth: number,
  indent = "",
): string[] {
  const avail = Math.max(10, maxWidth - indent.length);
  const paragraphs = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (trimmed.length === 0) {
      out.push("");
      continue;
    }
    const words = trimmed.split(/\s+/);
    let current = "";

    for (const word of words) {
      if (word.length > avail) {
        if (current.length > 0) {
          out.push(`${indent}${current}`);
          current = "";
        }
        for (let i = 0; i < word.length; i += avail) {
          out.push(`${indent}${word.slice(i, i + avail)}`);
        }
        continue;
      }

      const candidate = current.length === 0 ? word : `${current} ${word}`;
      if (candidate.length <= avail) {
        current = candidate;
      } else {
        out.push(`${indent}${current}`);
        current = word;
      }
    }

    if (current.length > 0) {
      out.push(`${indent}${current}`);
    }
  }

  return out;
}

function renderBar(
  score: number | null,
  barWidth: number,
  p: Palette,
): string {
  if (score === null) {
    return p.grey("░".repeat(barWidth));
  }
  const clamped = Math.max(0, Math.min(100, score));
  const filled = Math.round((clamped / 100) * barWidth);
  const empty = Math.max(0, barWidth - filled);
  const colorFn = p.scoreColor(clamped);
  return colorFn("█".repeat(filled)) + p.dim("░".repeat(empty));
}

function renderDimensionRow(
  d: JudgedDimension,
  barWidth: number,
  p: Palette,
): string {
  const dim = getDimension(d.dimension);
  const nameCol = dim.title.padEnd(20);
  const weightPct = `${Math.round(dim.weight * 100)}%`.padStart(4);

  if (d.inconclusive || d.score === null) {
    const bar = renderBar(null, barWidth, p);
    const incLabel = p.grey("inconclusive".padEnd(12));
    const confCol = p.dim("—".padStart(7));
    return `  ${nameCol} ${p.dim(weightPct)}  ${bar}  ${incLabel} ${confCol}`;
  }

  const bar = renderBar(d.score, barWidth, p);
  const scoreRaw = `${d.score}/100`.padStart(7);
  const scoreCol = p.scoreColor(d.score)(scoreRaw);
  const confPct = `conf ${Math.round(d.confidence * 100)}%`.padStart(9);
  return `  ${nameCol} ${p.dim(weightPct)}  ${bar}  ${scoreCol} ${p.dim(confPct)}`;
}

/**
 * Render a Scorecard into a terminal-friendly layout.
 * Pure function: no I/O, deterministic output for a given Scorecard and options.
 */
export function renderTerminal(
  scorecard: Scorecard,
  options: RenderTerminalOptions = {},
): string {
  const useColor =
    options.color !== undefined
      ? options.color
      : shouldUseColor();
  const width = Math.max(60, Math.min(120, Math.floor(options.width ?? 80)));
  const p = makePalette(useColor);
  const rule = p.dim("─".repeat(width));
  const heavyRule = p.dim("═".repeat(width));

  const lines: string[] = [];

  // Title banner
  lines.push(heavyRule);
  lines.push(
    `${p.bold("SHIP OR THEATER")} ${p.dim("— Reality Scorecard")}`,
  );
  lines.push(rule);

  // Verdict badge + gloss
  const badge = p.badge(scorecard.verdict);
  const gloss = VERDICT_GLOSS[scorecard.verdict];
  const badgePlainLen = stripAnsi(badge).length;
  if (badgePlainLen + 2 + gloss.length <= width) {
    lines.push(`${badge}  ${p.bold(gloss)}`);
  } else {
    lines.push(badge);
    lines.push(...wrapText(gloss, width, "  ").map((l) => p.bold(l)));
  }

  // Reality score + bar
  const overallBarWidth = width >= 76 ? 20 : 12;
  const overallBar = renderBar(scorecard.overallScore, overallBarWidth, p);
  const overallScoreText =
    scorecard.overallScore === null
      ? p.grey("— (inconclusive)")
      : p.bold(
          p.scoreColor(scorecard.overallScore)(
            `${scorecard.overallScore} / 100`,
          ),
        );
  lines.push(`Reality Score  ${overallBar}  ${overallScoreText}`);
  lines.push(rule);

  // Claim & Summary
  lines.push(p.bold("CLAIM"));
  lines.push(...wrapText(scorecard.input.claim, width, "  "));
  if (scorecard.input.sourceUrl) {
    lines.push(...wrapText(`Source: ${scorecard.input.sourceUrl}`, width, "  ").map((l) => p.dim(l)));
  }
  lines.push("");
  lines.push(p.bold("SUMMARY"));
  lines.push(...wrapText(scorecard.summary, width, "  "));
  lines.push(rule);

  // Dimensions table
  const { usable, inconclusive } = countUsable(scorecard.dimensions);
  lines.push(
    `${p.bold("DIMENSIONS")} ${p.dim(`(${usable}/${scorecard.dimensions.length} scored${inconclusive > 0 ? `, ${inconclusive} inconclusive` : ""})`)}`,
  );
  const dimBarWidth = width >= 76 ? 16 : 10;
  for (const d of scorecard.dimensions) {
    lines.push(renderDimensionRow(d, dimBarWidth, p));
  }
  lines.push(rule);

  // Strongest steelman
  lines.push(p.bold(p.green("STRONGEST STEELMAN (best case FOR)")));
  lines.push(...wrapText(scorecard.strongestSteelman, width, "  "));
  lines.push("");

  // Strongest debunk
  lines.push(p.bold(p.red("STRONGEST DEBUNK (best case AGAINST)")));
  lines.push(...wrapText(scorecard.strongestDebunk, width, "  "));
  lines.push(rule);

  // Footer
  const footerRaw = `ship-or-theater · ${scorecard.model} · ${scorecard.generatedAt}`;
  for (const line of wrapText(footerRaw, width, "")) {
    lines.push(p.dim(line));
  }

  return lines.join("\n");
}

/**
 * Render the fixed reality rubric and verdict bands (no model or API key required).
 */
export function renderRubric(
  options: RenderTerminalOptions & { format?: OutputFormat } = {},
): string {
  const format = options.format ?? "pretty";

  if (format === "json") {
    return JSON.stringify(
      {
        dimensions: RUBRIC.map((d) => ({
          index: d.index,
          key: d.key,
          title: d.title,
          weight: d.weight,
          question: d.question,
        })),
        verdictBands: {
          SHIPS: `>= ${VERDICT_BANDS.shipsMin}`,
          MIXED: `${VERDICT_BANDS.mixedMin}-${VERDICT_BANDS.shipsMin - 1}`,
          THEATER: `< ${VERDICT_BANDS.mixedMin}`,
          INCONCLUSIVE: "null (no usable dimensions)",
        },
      },
      null,
      2,
    );
  }

  if (format === "markdown") {
    const lines: string[] = [
      "# Ship or Theater — Fixed Reality Rubric",
      "",
      "| # | Dimension | Weight | Question |",
      "|---|-----------|--------|----------|",
      ...RUBRIC.map(
        (d) =>
          `| ${d.index} | ${d.title} | ${Math.round(d.weight * 100)}% (${d.weight}) | ${d.question} |`,
      ),
      "",
      "## Verdict Bands",
      "",
      `- **SHIPS** (>= ${VERDICT_BANDS.shipsMin}): ${VERDICT_GLOSS.SHIPS}`,
      `- **MIXED** (${VERDICT_BANDS.mixedMin}–${VERDICT_BANDS.shipsMin - 1}): ${VERDICT_GLOSS.MIXED}`,
      `- **THEATER** (< ${VERDICT_BANDS.mixedMin}): ${VERDICT_GLOSS.THEATER}`,
      `- **INCONCLUSIVE**: ${VERDICT_GLOSS.INCONCLUSIVE}`,
    ];
    return lines.join("\n");
  }

  const useColor =
    options.color !== undefined ? options.color : shouldUseColor();
  const width = Math.max(60, Math.min(120, Math.floor(options.width ?? 80)));
  const p = makePalette(useColor);
  const rule = p.dim("─".repeat(width));

  const lines: string[] = [
    rule,
    `${p.bold("SHIP OR THEATER")} ${p.dim("— Fixed Reality Rubric")}`,
    rule,
  ];

  for (const d of RUBRIC) {
    const pct = `${Math.round(d.weight * 100)}% (${d.weight})`;
    lines.push(
      `  ${p.bold(`${d.index}. ${d.title.padEnd(21)}`)} ${p.cyan(pct.padEnd(11))}`,
    );
    lines.push(...wrapText(d.question, width, "     ").map((l) => p.dim(l)));
  }

  lines.push(rule);
  lines.push(p.bold("VERDICT BANDS"));
  lines.push(
    `  ${p.badge("SHIPS")}  ${p.bold(`>= ${VERDICT_BANDS.shipsMin}`)}     ${p.dim(VERDICT_GLOSS.SHIPS)}`,
  );
  lines.push(
    `  ${p.badge("MIXED")}  ${p.bold(`${VERDICT_BANDS.mixedMin}–${VERDICT_BANDS.shipsMin - 1}`)}     ${p.dim(VERDICT_GLOSS.MIXED)}`,
  );
  lines.push(
    `  ${p.badge("THEATER")}  ${p.bold(`< ${VERDICT_BANDS.mixedMin}`)}      ${p.dim(VERDICT_GLOSS.THEATER)}`,
  );
  lines.push(
    `  ${p.badge("INCONCLUSIVE")}  ${p.dim(VERDICT_GLOSS.INCONCLUSIVE)}`,
  );
  lines.push(rule);

  return lines.join("\n");
}

/**
 * Format a single live progress line showing the 4-stage pipeline status:
 * `extractor → 6 skeptics → steelman → judge`
 */
export function formatProgressLine(
  event: ProgressEvent,
  options: { color?: boolean } = {},
): string {
  const useColor =
    options.color !== undefined ? options.color : shouldUseColor();
  const p = makePalette(useColor);

  const skepticLabel =
    event.stage === "skeptics" &&
    typeof event.skepticsCompleted === "number" &&
    typeof event.skepticsTotal === "number"
      ? `6 skeptics (${event.skepticsCompleted}/${event.skepticsTotal})`
      : "6 skeptics";

  const stages: Array<{ id: ProgressEvent["stage"]; label: string }> = [
    { id: "extractor", label: "extractor" },
    { id: "skeptics", label: skepticLabel },
    { id: "steelman", label: "steelman" },
    { id: "judge", label: "judge" },
  ];

  const order = ["extractor", "skeptics", "steelman", "judge", "done"];
  const currentIdx = order.indexOf(event.stage);

  const rendered = stages.map((s, idx) => {
    if (idx < currentIdx) return p.green(`✓ ${s.label}`);
    if (idx === currentIdx) return p.bold(p.cyan(`● ${s.label}`));
    return p.dim(s.label);
  });

  return `${p.dim("[ship-or-theater]")} ${rendered.join(p.dim(" → "))}`;
}

export interface ProgressStream {
  isTTY?: boolean;
  write: (chunk: string) => boolean;
}

/**
 * Create a live stderr progress reporter that updates only when `stream.isTTY` is true.
 */
export function createProgressReporter(
  stream: ProgressStream = process.stderr,
  options: { color?: boolean } = {},
): {
  onProgress: (event: ProgressEvent) => void;
  clear: () => void;
} {
  if (!stream.isTTY) {
    return {
      onProgress: () => {},
      clear: () => {},
    };
  }

  let active = false;
  const clear = () => {
    if (active) {
      stream.write("\r\x1b[K");
      active = false;
    }
  };

  const onProgress = (event: ProgressEvent) => {
    if (event.stage === "done") {
      clear();
      return;
    }
    active = true;
    const line = formatProgressLine(event, options);
    stream.write(`\r\x1b[K${line}`);
  };

  return { onProgress, clear };
}
