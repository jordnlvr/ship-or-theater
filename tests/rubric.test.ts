import { describe, expect, it } from "vitest";
import {
  RUBRIC,
  TOTAL_WEIGHT,
  VERDICT_BANDS,
  computeScore,
  countUsable,
  getDimension,
  toVerdict,
} from "../src/rubric.js";
import type { JudgedDimension } from "../src/types.js";

function judged(
  dimension: JudgedDimension["dimension"],
  score: number | null,
  inconclusive = score === null,
): JudgedDimension {
  return {
    dimension,
    score,
    inconclusive,
    confidence: 0.8,
    reasoning: "test",
  };
}

describe("rubric structure", () => {
  it("has exactly the six fixed dimensions with the spec weights", () => {
    expect(RUBRIC.map((d) => d.key)).toEqual([
      "reproducibility",
      "evidence_quality",
      "scope_honesty",
      "production_readiness",
      "novelty",
      "hidden_caveats",
    ]);
    expect(getDimension("reproducibility").weight).toBe(0.2);
    expect(getDimension("evidence_quality").weight).toBe(0.2);
    expect(getDimension("scope_honesty").weight).toBe(0.2);
    expect(getDimension("production_readiness").weight).toBe(0.15);
    expect(getDimension("novelty").weight).toBe(0.1);
    expect(getDimension("hidden_caveats").weight).toBe(0.15);
  });

  it("weights sum to exactly 1.0", () => {
    expect(TOTAL_WEIGHT).toBeCloseTo(1.0, 10);
  });
});

describe("toVerdict bands", () => {
  it("maps null to INCONCLUSIVE (never a guess)", () => {
    expect(toVerdict(null)).toBe("INCONCLUSIVE");
  });

  it("honors the 70 boundary for SHIPS", () => {
    expect(toVerdict(70)).toBe("SHIPS");
    expect(toVerdict(69.9)).toBe("MIXED");
    expect(VERDICT_BANDS.shipsMin).toBe(70);
  });

  it("honors the 40 boundary for MIXED vs THEATER", () => {
    expect(toVerdict(40)).toBe("MIXED");
    expect(toVerdict(39.9)).toBe("THEATER");
    expect(VERDICT_BANDS.mixedMin).toBe(40);
  });

  it("maps extremes correctly", () => {
    expect(toVerdict(100)).toBe("SHIPS");
    expect(toVerdict(0)).toBe("THEATER");
  });
});

describe("computeScore weighted mean", () => {
  it("computes the exact weighted mean when all dimensions are usable", () => {
    // All scored 80 -> weighted mean is exactly 80 regardless of weights.
    const dims = RUBRIC.map((d) => judged(d.key, 80));
    expect(computeScore(dims)).toBe(80);
  });

  it("computes a specific known weighted value", () => {
    // reproducibility(0.2)=100, evidence(0.2)=50, rest=0.
    // weighted sum = 0.2*100 + 0.2*50 = 30; weight total = 1.0 -> 30.
    const dims: JudgedDimension[] = [
      judged("reproducibility", 100),
      judged("evidence_quality", 50),
      judged("scope_honesty", 0),
      judged("production_readiness", 0),
      judged("novelty", 0),
      judged("hidden_caveats", 0),
    ];
    expect(computeScore(dims)).toBe(30);
  });

  it("renormalizes when some dimensions are inconclusive", () => {
    // Only reproducibility(0.2)=90 and novelty(0.1)=60 are usable.
    // weighted sum = 0.2*90 + 0.1*60 = 24; weight total = 0.3 -> 80.
    const dims: JudgedDimension[] = [
      judged("reproducibility", 90),
      judged("evidence_quality", null),
      judged("scope_honesty", null),
      judged("production_readiness", null),
      judged("novelty", 60),
      judged("hidden_caveats", null),
    ];
    expect(computeScore(dims)).toBe(80);
  });

  it("returns null when every dimension is inconclusive (no guessed score)", () => {
    const dims = RUBRIC.map((d) => judged(d.key, null));
    expect(computeScore(dims)).toBeNull();
  });

  it("treats inconclusive=true as excluded even if a score is present", () => {
    const dims: JudgedDimension[] = [judged("reproducibility", 100, true)];
    expect(computeScore(dims)).toBeNull();
  });
});

describe("countUsable", () => {
  it("counts usable vs inconclusive", () => {
    const dims: JudgedDimension[] = [
      judged("reproducibility", 90),
      judged("evidence_quality", null),
      judged("novelty", 60),
    ];
    expect(countUsable(dims)).toEqual({ usable: 2, inconclusive: 1 });
  });
});
