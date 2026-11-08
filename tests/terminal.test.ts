import { describe, expect, it } from "vitest";
import { RUBRIC } from "../src/rubric.js";
import {
  createProgressReporter,
  formatProgressLine,
  renderRubric,
  renderTerminal,
  resolveOutputFormat,
  shouldUseColor,
  stripAnsi,
} from "../src/terminal.js";
import type { JudgedDimension, Scorecard } from "../src/types.js";

function judged(
  dimension: JudgedDimension["dimension"],
  score: number | null,
): JudgedDimension {
  return {
    dimension,
    score,
    inconclusive: score === null,
    confidence: score === null ? 0 : 0.85,
    reasoning: `reasoning for ${dimension}`,
  };
}

function makeScorecard(overrides: Partial<Scorecard> = {}): Scorecard {
  return {
    input: {
      claim:
        "Our autonomous coding agent resolves 92% of complex production issues in under 60 seconds with zero human review.",
      sourceUrl: "https://example.com/launch-announcement/autonomous-agent-v2",
    },
    verdict: "MIXED",
    overallScore: 55,
    dimensions: RUBRIC.map((d) => judged(d.key, 55)),
    summary:
      "The vendor claims a high autonomous resolution rate on production issues without publishing the benchmark dataset.",
    assertions: [
      {
        id: "a1",
        text: "Resolves 92% of complex production issues.",
        testable: true,
        relatesTo: ["evidence_quality", "reproducibility"],
      },
    ],
    strongestSteelman:
      "Prior releases from this engineering team showed measurable gains on open benchmarks.",
    strongestDebunk:
      "Evidence quality (severity 85/100): No benchmark dataset, harness, or reproduction script was disclosed.",
    model: "claude-sonnet-5-5",
    generatedAt: "2026-11-07T17:00:00.000Z",
    ...overrides,
  };
}

describe("renderTerminal", () => {
  it("renders verdict badge, reality score bar, all 6 dimensions, steelman, debunk, and footer", () => {
    const out = renderTerminal(makeScorecard(), { color: true, width: 80 });
    expect(out).toContain("\x1b["); // has ANSI styling
    const plain = stripAnsi(out);
    expect(plain).toContain("SHIP OR THEATER");
    expect(plain).toContain("MIXED");
    expect(plain).toContain("55 / 100");
    expect(plain).toContain("█");
    for (const d of RUBRIC) {
      expect(plain).toContain(d.title);
    }
    expect(plain).toContain("STRONGEST STEELMAN");
    expect(plain).toContain("STRONGEST DEBUNK");
    expect(plain).toContain("claude-sonnet-5-5");
  });

  it("renders all four verdict badges distinctly (SHIPS, MIXED, THEATER, INCONCLUSIVE)", () => {
    const ships = renderTerminal(
      makeScorecard({ verdict: "SHIPS", overallScore: 82 }),
      { color: true },
    );
    const mixed = renderTerminal(
      makeScorecard({ verdict: "MIXED", overallScore: 55 }),
      { color: true },
    );
    const theater = renderTerminal(
      makeScorecard({ verdict: "THEATER", overallScore: 22 }),
      { color: true },
    );
    const inconclusive = renderTerminal(
      makeScorecard({
        verdict: "INCONCLUSIVE",
        overallScore: null,
        dimensions: RUBRIC.map((d) => judged(d.key, null)),
      }),
      { color: true },
    );

    expect(ships).toContain("\x1b[42;30;1m SHIPS \x1b[0m");
    expect(mixed).toContain("\x1b[43;30;1m MIXED \x1b[0m");
    expect(theater).toContain("\x1b[41;37;1m THEATER \x1b[0m");
    expect(inconclusive).toContain("\x1b[100;37;1m INCONCLUSIVE \x1b[0m");
    expect(stripAnsi(inconclusive)).toContain("— (inconclusive)");
  });

  it("respects color: false, NO_COLOR, and --no-color with zero ANSI codes", () => {
    expect(shouldUseColor({ colorFlag: false, env: {} })).toBe(false);
    expect(shouldUseColor({ colorFlag: true, env: { NO_COLOR: "1" } })).toBe(
      false,
    );
    expect(shouldUseColor({ env: {} })).toBe(true);

    const out = renderTerminal(makeScorecard(), { color: false, width: 80 });
    expect(out).not.toContain("\x1b[");
    expect(out).toContain("[MIXED]");
  });

  it("is width-aware and fits every line within 60 columns at minimum width", () => {
    const out = renderTerminal(makeScorecard(), { color: true, width: 60 });
    const lines = out.split("\n");
    for (const line of lines) {
      const visible = stripAnsi(line);
      expect(visible.length).toBeLessThanOrEqual(60);
    }
  });

  it("renders inconclusive dimensions with 'inconclusive' and exclusion count", () => {
    const dims = RUBRIC.map((d, i) =>
      i < 2 ? judged(d.key, null) : judged(d.key, 75),
    );
    const plain = stripAnsi(
      renderTerminal(makeScorecard({ dimensions: dims }), { color: false }),
    );
    expect(plain).toContain("inconclusive");
    expect(plain).toContain("(4/6 scored, 2 inconclusive)");
  });
});

describe("renderRubric & resolveOutputFormat", () => {
  it("renders the rubric in pretty, markdown, and json formats", () => {
    const pretty = stripAnsi(renderRubric({ format: "pretty", color: false }));
    const md = renderRubric({ format: "markdown" });
    const json = JSON.parse(renderRubric({ format: "json" })) as {
      dimensions: unknown[];
      verdictBands: Record<string, string>;
    };

    for (const d of RUBRIC) {
      expect(pretty).toContain(d.title);
      expect(md).toContain(d.title);
    }
    expect(json.dimensions).toHaveLength(6);
    expect(json.verdictBands.SHIPS).toBe(">= 70");
  });

  it("resolves format based on --format, --json, and TTY state", () => {
    expect(resolveOutputFormat({ isTTY: true })).toBe("pretty");
    expect(resolveOutputFormat({ isTTY: false })).toBe("markdown");
    expect(resolveOutputFormat({ json: true, isTTY: true })).toBe("json");
    expect(resolveOutputFormat({ format: "markdown", isTTY: true })).toBe(
      "markdown",
    );
    expect(resolveOutputFormat({ format: "pretty", isTTY: false })).toBe(
      "pretty",
    );
    expect(resolveOutputFormat({ format: "bogus", isTTY: true })).toEqual({
      error: 'Invalid format "bogus". Expected one of: pretty, markdown, json.',
    });
  });
});

describe("TTY progress reporter", () => {
  it("writes progress lines in TTY and clears on done, and is silent in non-TTY", () => {
    const ttyChunks: string[] = [];
    const ttyReporter = createProgressReporter(
      {
        isTTY: true,
        write: (c) => {
          ttyChunks.push(c);
          return true;
        },
      },
      { color: false },
    );

    ttyReporter.onProgress({ stage: "extractor" });
    ttyReporter.onProgress({
      stage: "skeptics",
      skepticsCompleted: 3,
      skepticsTotal: 6,
    });
    ttyReporter.onProgress({ stage: "steelman" });
    ttyReporter.onProgress({ stage: "judge" });
    ttyReporter.onProgress({ stage: "done" });

    expect(ttyChunks.length).toBeGreaterThanOrEqual(5);
    expect(ttyChunks[1]).toContain("6 skeptics (3/6)");
    expect(ttyChunks[ttyChunks.length - 1]).toBe("\r\x1b[K");

    const nonTtyChunks: string[] = [];
    const nonTtyReporter = createProgressReporter({
      isTTY: false,
      write: (c) => {
        nonTtyChunks.push(c);
        return true;
      },
    });
    nonTtyReporter.onProgress({ stage: "extractor" });
    nonTtyReporter.onProgress({ stage: "done" });
    expect(nonTtyChunks).toHaveLength(0);

    const line = stripAnsi(
      formatProgressLine(
        { stage: "skeptics", skepticsCompleted: 2, skepticsTotal: 6 },
        { color: false },
      ),
    );
    expect(line).toContain(
      "✓ extractor → ● 6 skeptics (2/6) → steelman → judge",
    );
  });
});
