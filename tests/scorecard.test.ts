import { describe, expect, it } from "vitest";
import { renderMarkdown, toJSON } from "../src/scorecard.js";
import { RUBRIC } from "../src/rubric.js";
import type { JudgedDimension, Scorecard } from "../src/types.js";

function judged(
  dimension: JudgedDimension["dimension"],
  score: number | null,
): JudgedDimension {
  return {
    dimension,
    score,
    inconclusive: score === null,
    confidence: score === null ? 0 : 0.75,
    reasoning: `reasoning for ${dimension}`,
  };
}

function makeScorecard(overrides: Partial<Scorecard> = {}): Scorecard {
  return {
    input: { claim: "Our model beats GPT-4 on internal benchmarks." },
    verdict: "MIXED",
    overallScore: 55,
    dimensions: RUBRIC.map((d) => judged(d.key, 55)),
    summary: "A vendor claims a benchmark win.",
    assertions: [
      {
        id: "a1",
        text: "Beats GPT-4 internally.",
        testable: true,
        relatesTo: ["evidence_quality"],
      },
    ],
    strongestSteelman: "The team has a track record.",
    strongestDebunk: "No independent reproduction was provided.",
    model: "claude-sonnet-4-6",
    generatedAt: "2026-05-31T00:00:00.000Z",
    ...overrides,
  };
}

describe("renderMarkdown", () => {
  it("renders verdict, score, and all dimension rows", () => {
    const md = renderMarkdown(makeScorecard());
    expect(md).toContain("**Verdict:** MIXED");
    expect(md).toContain("**Reality score:** 55 / 100");
    for (const d of RUBRIC) {
      expect(md).toContain(d.title);
    }
    expect(md).toContain("Strongest steelman");
    expect(md).toContain("Strongest debunk");
    expect(md).toContain("The team has a track record.");
    expect(md).toContain("No independent reproduction was provided.");
  });

  it("renders inconclusive dimensions and the exclusion count", () => {
    const dims = RUBRIC.map((d, i) =>
      i < 2 ? judged(d.key, null) : judged(d.key, 80),
    );
    const md = renderMarkdown(makeScorecard({ dimensions: dims }));
    expect(md).toContain("inconclusive");
    expect(md).toContain("4 of 6 dimensions scored; 2 inconclusive");
  });

  it("renders an INCONCLUSIVE scorecard without asserting a score", () => {
    const dims = RUBRIC.map((d) => judged(d.key, null));
    const md = renderMarkdown(
      makeScorecard({
        verdict: "INCONCLUSIVE",
        overallScore: null,
        dimensions: dims,
      }),
    );
    expect(md).toContain("**Verdict:** INCONCLUSIVE");
    expect(md).toContain("**Reality score:** —");
    expect(md).not.toContain("/ 100");
  });
});

describe("toJSON", () => {
  it("round-trips to a parseable object with the verdict preserved", () => {
    const card = makeScorecard();
    const json = toJSON(card);
    const parsed = JSON.parse(json) as Scorecard;
    expect(parsed.verdict).toBe("MIXED");
    expect(parsed.overallScore).toBe(55);
    expect(parsed.dimensions).toHaveLength(6);
  });
});
