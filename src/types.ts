import { z } from "zod";

/**
 * Canonical shapes for the whole tool. Every agent boundary and the public API
 * parse through these schemas, so there is a single source of truth for data
 * that flows between the extractor, skeptics, steelman, judge, and scorecard.
 */

/** The six fixed rubric dimensions. Keys are stable identifiers used everywhere. */
export const DIMENSION_KEYS = [
  "reproducibility",
  "evidence_quality",
  "scope_honesty",
  "production_readiness",
  "novelty",
  "hidden_caveats",
] as const;

export type DimensionKey = (typeof DIMENSION_KEYS)[number];

export const DimensionKeySchema = z.enum(DIMENSION_KEYS);

/** Input the caller provides: the claim plus optional surrounding context. */
export const EvaluationInputSchema = z.object({
  claim: z.string().min(1, "claim must not be empty"),
  context: z.string().optional(),
  sourceUrl: z.string().url().optional(),
});
export type EvaluationInput = z.infer<typeof EvaluationInputSchema>;

/** A single testable assertion pulled out of the raw claim by the extractor. */
export const AssertionSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  testable: z.boolean(),
  relatesTo: z.array(DimensionKeySchema),
});
export type Assertion = z.infer<typeof AssertionSchema>;

/** What the extractor agent returns. */
export const ExtractionSchema = z.object({
  assertions: z.array(AssertionSchema),
  summary: z.string().min(1),
});
export type Extraction = z.infer<typeof ExtractionSchema>;

/**
 * A skeptic's finding for one dimension: the case that this dimension is
 * "theater" rather than real, plus a self-assessed severity.
 */
export const SkepticFindingSchema = z.object({
  dimension: DimensionKeySchema,
  concerns: z.array(z.string().min(1)),
  /** 0 = no concern (looks real), 100 = maximal red flag (pure theater). */
  severity: z.number().min(0).max(100),
  reasoning: z.string().min(1),
});
export type SkepticFinding = z.infer<typeof SkepticFindingSchema>;

/** The steelman agent's strongest defensible case for the claim. */
export const SteelmanSchema = z.object({
  strongestCase: z.string().min(1),
  supportingPoints: z.array(z.string().min(1)),
});
export type Steelman = z.infer<typeof SteelmanSchema>;

/**
 * The judge's verdict for a single dimension after weighing skeptic vs.
 * steelman. `score` is null when the evidence does not support any number —
 * that dimension becomes `inconclusive` and is excluded from the mean.
 */
export const JudgedDimensionSchema = z.object({
  dimension: DimensionKeySchema,
  score: z.number().min(0).max(100).nullable(),
  inconclusive: z.boolean(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().min(1),
});
export type JudgedDimension = z.infer<typeof JudgedDimensionSchema>;

/** What the judge agent returns: one judged entry per supplied dimension. */
export const JudgementSchema = z.object({
  dimensions: z.array(JudgedDimensionSchema),
});
export type Judgement = z.infer<typeof JudgementSchema>;

export const VERDICTS = ["SHIPS", "MIXED", "THEATER", "INCONCLUSIVE"] as const;
export type Verdict = (typeof VERDICTS)[number];

/** The fully assembled result: verdict, score, per-dimension detail, evidence. */
export const ScorecardSchema = z.object({
  input: EvaluationInputSchema,
  verdict: z.enum(VERDICTS),
  /** Weighted-mean reality score over available dimensions; null if none. */
  overallScore: z.number().min(0).max(100).nullable(),
  dimensions: z.array(JudgedDimensionSchema),
  summary: z.string().min(1),
  assertions: z.array(AssertionSchema),
  strongestSteelman: z.string().min(1),
  strongestDebunk: z.string().min(1),
  model: z.string().min(1),
  generatedAt: z.string().min(1),
});
export type Scorecard = z.infer<typeof ScorecardSchema>;
