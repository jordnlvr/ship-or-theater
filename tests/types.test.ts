import { describe, expect, it } from "vitest";
import {
  AssertionSchema,
  EvaluationInputSchema,
  JudgedDimensionSchema,
  ScorecardSchema,
  SkepticFindingSchema,
} from "../src/types.js";

describe("EvaluationInputSchema", () => {
  it("accepts a minimal valid input", () => {
    const parsed = EvaluationInputSchema.parse({ claim: "Model beats GPT-4." });
    expect(parsed.claim).toBe("Model beats GPT-4.");
  });

  it("rejects an empty claim", () => {
    expect(() => EvaluationInputSchema.parse({ claim: "" })).toThrow();
  });

  it("rejects a malformed sourceUrl", () => {
    expect(() =>
      EvaluationInputSchema.parse({ claim: "x", sourceUrl: "not-a-url" }),
    ).toThrow();
  });

  it("accepts a well-formed sourceUrl", () => {
    const parsed = EvaluationInputSchema.parse({
      claim: "x",
      sourceUrl: "https://example.com/post",
    });
    expect(parsed.sourceUrl).toBe("https://example.com/post");
  });
});

describe("AssertionSchema", () => {
  it("rejects an unknown dimension key in relatesTo", () => {
    expect(() =>
      AssertionSchema.parse({
        id: "a1",
        text: "x",
        testable: true,
        relatesTo: ["not_a_dimension"],
      }),
    ).toThrow();
  });
});

describe("SkepticFindingSchema", () => {
  it("rejects severity out of range", () => {
    expect(() =>
      SkepticFindingSchema.parse({
        dimension: "novelty",
        concerns: [],
        severity: 150,
        reasoning: "x",
      }),
    ).toThrow();
  });
});

describe("JudgedDimensionSchema", () => {
  it("accepts a null score (inconclusive)", () => {
    const parsed = JudgedDimensionSchema.parse({
      dimension: "novelty",
      score: null,
      inconclusive: true,
      confidence: 0,
      reasoning: "no evidence",
    });
    expect(parsed.score).toBeNull();
  });

  it("rejects confidence above 1", () => {
    expect(() =>
      JudgedDimensionSchema.parse({
        dimension: "novelty",
        score: 50,
        inconclusive: false,
        confidence: 2,
        reasoning: "x",
      }),
    ).toThrow();
  });
});

describe("ScorecardSchema", () => {
  it("rejects an invalid verdict", () => {
    expect(() =>
      ScorecardSchema.parse({
        input: { claim: "x" },
        verdict: "MAYBE",
        overallScore: 50,
        dimensions: [],
        summary: "s",
        assertions: [],
        strongestSteelman: "a",
        strongestDebunk: "b",
        model: "m",
        generatedAt: "t",
      }),
    ).toThrow();
  });
});
