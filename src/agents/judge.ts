import { getDimension } from "../rubric.js";
import { zodToJsonSchema } from "../jsonschema.js";
import type { LLM } from "../llm.js";
import {
  type DimensionKey,
  type EvaluationInput,
  type Judgement,
  JudgementSchema,
  type SkepticFinding,
  type Steelman,
} from "../types.js";
import { RUBRIC_BLOCK, renderInput } from "./shared.js";

/**
 * Judge: weighs the skeptic findings against the steelman and produces a
 * per-dimension score, confidence, and reasoning. It only judges the
 * dimensions whose skeptic actually succeeded (passed in by the pipeline), and
 * it is explicitly allowed to mark a dimension inconclusive (score null) when
 * the evidence does not support a number. Pure given an injected `llm`.
 */
export async function runJudge(
  llm: LLM,
  input: EvaluationInput,
  findings: readonly SkepticFinding[],
  steelman: Steelman,
): Promise<Judgement> {
  const dimensionsToJudge: DimensionKey[] = findings.map((f) => f.dimension);

  const findingsBlock = findings
    .map((f) => {
      const dim = getDimension(f.dimension);
      const concerns =
        f.concerns.length > 0
          ? f.concerns.map((c) => `    - ${c}`).join("\n")
          : "    - (none recorded)";
      return [
        `Dimension: ${dim.title} (${f.dimension})`,
        `  Skeptic severity: ${f.severity}/100`,
        `  Skeptic reasoning: ${f.reasoning}`,
        `  Concerns:`,
        concerns,
      ].join("\n");
    })
    .join("\n\n");

  const prompt = [
    "You are the judge. Weigh the skeptic findings against the steelman and",
    "assign each dimension below a final score 0-100 (100 = real/credible,",
    "0 = theater), a confidence 0-1, and a one-paragraph reasoning.",
    "",
    "Rules you must follow:",
    "- Only judge the dimensions listed below. Do not add or drop dimensions.",
    "- If a dimension has no usable evidence in either direction, set",
    "  inconclusive=true and score=null. Never guess a number.",
    "- A higher skeptic severity should push the score DOWN; a strong steelman",
    "  point should push it UP. Be calibrated, not reflexively harsh or kind.",
    "",
    `DIMENSIONS TO JUDGE: ${dimensionsToJudge.join(", ")}`,
    "",
    "SKEPTIC FINDINGS:",
    findingsBlock,
    "",
    "STEELMAN (strongest case FOR the claim):",
    steelman.strongestCase,
    ...steelman.supportingPoints.map((p) => `  + ${p}`),
    "",
    renderInput(input),
  ].join("\n");

  const judgement = await llm({
    system: RUBRIC_BLOCK,
    prompt,
    toolName: "record_judgement",
    toolDescription:
      "Record the final per-dimension scores, confidence, and reasoning.",
    schema: JudgementSchema,
    jsonSchema: zodToJsonSchema(JudgementSchema),
  });

  return normalizeJudgement(judgement, dimensionsToJudge);
}

/**
 * Defensive normalization: ensure the judge returns exactly one entry per
 * requested dimension, and that the inconclusive flag and null score stay
 * consistent. A dimension the judge omitted becomes inconclusive (not a guess);
 * a dimension it judged with a null score is forced inconclusive.
 */
export function normalizeJudgement(
  judgement: Judgement,
  requested: readonly DimensionKey[],
): Judgement {
  const byKey = new Map(judgement.dimensions.map((d) => [d.dimension, d]));

  const dimensions = requested.map((key) => {
    const entry = byKey.get(key);
    if (!entry) {
      return {
        dimension: key,
        score: null,
        inconclusive: true,
        confidence: 0,
        reasoning:
          "The judge returned no entry for this dimension; treated as inconclusive.",
      };
    }
    // Keep score and inconclusive flag mutually consistent.
    if (entry.score === null && !entry.inconclusive) {
      return { ...entry, inconclusive: true };
    }
    if (entry.inconclusive && entry.score !== null) {
      return { ...entry, score: null };
    }
    return entry;
  });

  return { dimensions };
}
