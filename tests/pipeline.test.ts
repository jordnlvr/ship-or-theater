import { describe, expect, it } from "vitest";
import { evaluate } from "../src/pipeline.js";
import { ScorecardSchema, type SkepticFinding } from "../src/types.js";
import { makeFakeLLM } from "./fake-llm.js";

const INPUT = {
  claim: "Our model beats GPT-4 on internal benchmarks.",
  context: "From a launch blog post.",
};

const fixedNow = () => new Date("2026-05-31T12:00:00.000Z");

describe("evaluate — happy path", () => {
  it("produces a valid Scorecard with all six dimensions scored", async () => {
    const { llm, calls } = makeFakeLLM();
    const card = await evaluate(llm, INPUT, { now: fixedNow });

    // Schema-valid by construction.
    expect(() => ScorecardSchema.parse(card)).not.toThrow();
    expect(card.dimensions).toHaveLength(6);
    expect(card.dimensions.every((d) => !d.inconclusive)).toBe(true);
    expect(card.overallScore).not.toBeNull();
    expect(["SHIPS", "MIXED", "THEATER"]).toContain(card.verdict);

    // Default skeptic severity 40 -> judge score 60 on every dimension -> mean 60.
    expect(card.overallScore).toBe(60);
    expect(card.verdict).toBe("MIXED");

    // Pipeline shape: 1 extractor + 6 skeptics + 1 steelman + 1 judge = 9 calls.
    expect(calls).toHaveLength(9);
    expect(
      calls.filter((c) => c.tool === "record_skeptic_finding"),
    ).toHaveLength(6);
  });

  it("selects the strongest debunk from the highest-severity skeptic", async () => {
    const skeptic = (dimension: string): SkepticFinding => ({
      dimension: dimension as SkepticFinding["dimension"],
      concerns: [`concern for ${dimension}`],
      severity: dimension === "hidden_caveats" ? 95 : 20,
      reasoning: `r-${dimension}`,
    });
    const { llm } = makeFakeLLM({ skeptic });
    const card = await evaluate(llm, INPUT, { now: fixedNow });
    expect(card.strongestDebunk).toContain("Hidden caveats");
    expect(card.strongestDebunk).toContain("95/100");
  });
});

describe("evaluate — one skeptic fails", () => {
  it("marks that dimension inconclusive and excludes it from the mean", async () => {
    const skeptic = (dimension: string): SkepticFinding | "throw" =>
      dimension === "novelty"
        ? "throw"
        : {
            dimension: dimension as SkepticFinding["dimension"],
            concerns: [`c-${dimension}`],
            severity: 30,
            reasoning: `r-${dimension}`,
          };

    const { llm } = makeFakeLLM({ skeptic });
    const card = await evaluate(llm, INPUT, { now: fixedNow });

    const novelty = card.dimensions.find((d) => d.dimension === "novelty");
    expect(novelty?.inconclusive).toBe(true);
    expect(novelty?.score).toBeNull();
    expect(novelty?.reasoning).toContain("skeptic");

    // The other five are scored (severity 30 -> score 70).
    const scored = card.dimensions.filter((d) => !d.inconclusive);
    expect(scored).toHaveLength(5);
    expect(scored.every((d) => d.score === 70)).toBe(true);

    // Weighted mean over the five usable dims is still 70 (all equal).
    expect(card.overallScore).toBe(70);
    expect(card.verdict).toBe("SHIPS");
  });
});

describe("evaluate — all skeptics fail", () => {
  it("returns a graceful INCONCLUSIVE scorecard, not a crash", async () => {
    const { llm } = makeFakeLLM({ skeptic: () => "throw" });
    const card = await evaluate(llm, INPUT, { now: fixedNow });

    expect(() => ScorecardSchema.parse(card)).not.toThrow();
    expect(card.dimensions).toHaveLength(6);
    expect(card.dimensions.every((d) => d.inconclusive)).toBe(true);
    expect(card.overallScore).toBeNull();
    expect(card.verdict).toBe("INCONCLUSIVE");
    // No debunk could be formed from zero findings — explicit, not fabricated.
    expect(card.strongestDebunk).toContain("No skeptic findings");
  });
});

describe("evaluate — judge marks a dimension inconclusive", () => {
  it("excludes a judge-nulled dimension from the weighted mean", async () => {
    const { llm } = makeFakeLLM({
      judge: (findings) => ({
        dimensions: findings.map((f, i) => ({
          dimension: f.dimension,
          score: i === 0 ? null : 80,
          inconclusive: i === 0,
          confidence: i === 0 ? 0 : 0.6,
          reasoning: `judged ${f.dimension}`,
        })),
      }),
    });
    const card = await evaluate(llm, INPUT, { now: fixedNow });
    const inconclusiveCount = card.dimensions.filter(
      (d) => d.inconclusive,
    ).length;
    expect(inconclusiveCount).toBe(1);
    expect(card.overallScore).toBe(80);
  });
});
