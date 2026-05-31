import type { DimensionKey, JudgedDimension, Verdict } from "./types.js";

/**
 * The rubric is the tool's point of view. It is fixed and weighted on purpose:
 * the scoring is opinionated but transparent. This module is pure (no LLM, no
 * I/O) so the math is fully unit-testable.
 */

export interface RubricDimension {
  key: DimensionKey;
  index: number;
  title: string;
  weight: number;
  question: string;
}

export const RUBRIC: readonly RubricDimension[] = [
  {
    key: "reproducibility",
    index: 1,
    title: "Reproducibility",
    weight: 0.2,
    question:
      "Could an independent party reproduce it, or is it a cherry-picked demo?",
  },
  {
    key: "evidence_quality",
    index: 2,
    title: "Evidence quality",
    weight: 0.2,
    question: "Real benchmarks/data vs. screenshots and vibes?",
  },
  {
    key: "scope_honesty",
    index: 3,
    title: "Scope honesty",
    weight: 0.2,
    question:
      "Does it generalize, or is narrow/overfit work dressed up as general?",
  },
  {
    key: "production_readiness",
    index: 4,
    title: "Production-readiness",
    weight: 0.15,
    question: "Demo vs. deployable (latency, cost, reliability, governance)?",
  },
  {
    key: "novelty",
    index: 5,
    title: "Novelty",
    weight: 0.1,
    question: "Genuine new capability or a wrapper/rebrand?",
  },
  {
    key: "hidden_caveats",
    index: 6,
    title: "Hidden caveats",
    weight: 0.15,
    question: "What's NOT said (failure modes, constraints, cost)?",
  },
] as const;

/** Sum of all weights, exactly 1.0 — guarded by a unit test. */
export const TOTAL_WEIGHT = RUBRIC.reduce((sum, d) => sum + d.weight, 0);

const RUBRIC_BY_KEY: Record<DimensionKey, RubricDimension> = Object.fromEntries(
  RUBRIC.map((d) => [d.key, d]),
) as Record<DimensionKey, RubricDimension>;

export function getDimension(key: DimensionKey): RubricDimension {
  return RUBRIC_BY_KEY[key];
}

/** Verdict band thresholds. SHIPS >= 70, MIXED 40-69, THEATER < 40. */
export const VERDICT_BANDS = {
  shipsMin: 70,
  mixedMin: 40,
} as const;

/**
 * Map a numeric reality score to a verdict band. `null` (no available
 * dimensions) yields INCONCLUSIVE — never a guessed verdict.
 */
export function toVerdict(score: number | null): Verdict {
  if (score === null) return "INCONCLUSIVE";
  if (score >= VERDICT_BANDS.shipsMin) return "SHIPS";
  if (score >= VERDICT_BANDS.mixedMin) return "MIXED";
  return "THEATER";
}

/**
 * Weighted mean over the dimensions that produced a usable score. Dimensions
 * that are inconclusive (or have a null score) are excluded entirely, and the
 * remaining weights are renormalized so the result stays on a 0-100 scale.
 * Returns null when no dimension is usable, so the caller never fabricates a
 * number out of thin air.
 */
export function computeScore(
  dimensions: readonly JudgedDimension[],
): number | null {
  let weightedSum = 0;
  let weightTotal = 0;

  for (const d of dimensions) {
    if (d.inconclusive || d.score === null) continue;
    const weight = RUBRIC_BY_KEY[d.dimension].weight;
    weightedSum += d.score * weight;
    weightTotal += weight;
  }

  if (weightTotal === 0) return null;

  const mean = weightedSum / weightTotal;
  // Round to one decimal place to avoid floating-point noise in output.
  return Math.round(mean * 10) / 10;
}

/** Convenience: how many dimensions are usable vs. inconclusive. */
export function countUsable(dimensions: readonly JudgedDimension[]): {
  usable: number;
  inconclusive: number;
} {
  let usable = 0;
  let inconclusive = 0;
  for (const d of dimensions) {
    if (d.inconclusive || d.score === null) inconclusive++;
    else usable++;
  }
  return { usable, inconclusive };
}
