import { runExtractor } from "./agents/extractor.js";
import { runJudge } from "./agents/judge.js";
import { runSkeptic } from "./agents/skeptic.js";
import { runSteelman } from "./agents/steelman.js";
import type { LLM } from "./llm.js";
import { resolveModel } from "./llm.js";
import { computeScore, getDimension, RUBRIC, toVerdict } from "./rubric.js";
import {
  DIMENSION_KEYS,
  type DimensionKey,
  type EvaluationInput,
  EvaluationInputSchema,
  type JudgedDimension,
  type Scorecard,
  ScorecardSchema,
  type SkepticFinding,
} from "./types.js";

/**
 * The orchestrator. Runs the adversarial pipeline:
 *   Extractor -> 6 parallel Skeptics -> Steelman -> Judge -> Scorecard.
 *
 * It takes an injected `llm` so the whole flow is testable with a fake. The
 * skeptic panel runs with `Promise.allSettled`: a failed dimension is recorded
 * as inconclusive (excluded from the weighted mean) instead of crashing the run.
 */
export interface EvaluateOptions {
  /** Model label recorded in the scorecard (defaults to the resolved model). */
  model?: string;
  /** Injectable clock, primarily for deterministic tests. */
  now?: () => Date;
}

export async function evaluate(
  llm: LLM,
  rawInput: EvaluationInput,
  options: EvaluateOptions = {},
): Promise<Scorecard> {
  const input = EvaluationInputSchema.parse(rawInput);
  const model = options.model ?? resolveModel();
  const now = options.now ?? (() => new Date());

  // 1. Extractor — must succeed; without assertions there is nothing to judge.
  const extraction = await runExtractor(llm, input);

  // 2. Skeptic panel — one per dimension, parallel and fault-tolerant.
  const settled = await Promise.allSettled(
    DIMENSION_KEYS.map((dimension) =>
      runSkeptic(llm, dimension, input, extraction),
    ),
  );

  const findings: SkepticFinding[] = [];
  const failedDimensions: DimensionKey[] = [];
  settled.forEach((result, i) => {
    const dimension = DIMENSION_KEYS[i]!;
    if (result.status === "fulfilled") {
      findings.push(result.value);
    } else {
      failedDimensions.push(dimension);
    }
  });

  // 3. Steelman — argues the best case FOR the claim.
  const steelman = await runSteelman(llm, input, extraction);

  // 4. Judge — scores only the dimensions whose skeptic succeeded.
  let judgedByKey = new Map<DimensionKey, JudgedDimension>();
  if (findings.length > 0) {
    const judgement = await runJudge(llm, input, findings, steelman);
    judgedByKey = new Map(judgement.dimensions.map((d) => [d.dimension, d]));
  }

  // 5. Assemble every dimension in rubric order. Dimensions whose skeptic
  //    failed (or that the judge did not score) are inconclusive — never a
  //    guessed number.
  const dimensions: JudgedDimension[] = RUBRIC.map((rubricDim) => {
    const judged = judgedByKey.get(rubricDim.key);
    if (judged) return judged;

    const skepticFailed = failedDimensions.includes(rubricDim.key);
    return {
      dimension: rubricDim.key,
      score: null,
      inconclusive: true,
      confidence: 0,
      reasoning: skepticFailed
        ? "The skeptic for this dimension failed; marked inconclusive and excluded from the score."
        : "No judged result was produced for this dimension; marked inconclusive.",
    };
  });

  const overallScore = computeScore(dimensions);
  const verdict = toVerdict(overallScore);

  const strongestDebunk = pickStrongestDebunk(findings);

  const scorecard: Scorecard = {
    input,
    verdict,
    overallScore,
    dimensions,
    summary: extraction.summary,
    assertions: extraction.assertions,
    strongestSteelman: steelman.strongestCase,
    strongestDebunk,
    model,
    generatedAt: now().toISOString(),
  };

  // Final guarantee: the returned object satisfies the public schema.
  return ScorecardSchema.parse(scorecard);
}

/**
 * The strongest debunk is the highest-severity skeptic's most pointed concern.
 * Pure selection over real findings — nothing fabricated. Returns an explicit
 * sentinel when no skeptic produced a concern, rather than inventing one.
 */
export function pickStrongestDebunk(
  findings: readonly SkepticFinding[],
): string {
  if (findings.length === 0) {
    return "No skeptic findings were available, so no debunk could be formed.";
  }

  const ranked = [...findings].sort((a, b) => b.severity - a.severity);
  const top = ranked[0]!;
  const dim = getDimension(top.dimension);
  const concern = top.concerns[0] ?? top.reasoning;
  return `${dim.title} (severity ${top.severity}/100): ${concern}`;
}
