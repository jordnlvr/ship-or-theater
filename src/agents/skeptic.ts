import { getDimension } from "../rubric.js";
import { zodToJsonSchema } from "../jsonschema.js";
import type { LLM } from "../llm.js";
import {
  type DimensionKey,
  type EvaluationInput,
  type Extraction,
  type SkepticFinding,
  SkepticFindingSchema,
} from "../types.js";
import { RUBRIC_BLOCK, renderInput } from "./shared.js";

/**
 * Skeptic: one instance per rubric dimension, run in parallel by the pipeline.
 * Each skeptic hunts for "theater" on its single assigned dimension — the gaps,
 * the missing evidence, the overclaim. Pure given an injected `llm`.
 */
export async function runSkeptic(
  llm: LLM,
  dimension: DimensionKey,
  input: EvaluationInput,
  extraction: Extraction,
): Promise<SkepticFinding> {
  const dim = getDimension(dimension);

  const prompt = [
    `You are the skeptic for ONE dimension only: ${dim.title} (${dimension}).`,
    `Question: ${dim.question}`,
    `When you record your finding, set dimension to exactly "${dimension}".`,
    "",
    "Hunt for every reason this claim could be theater on THIS dimension.",
    "List concrete concerns (missing reproduction steps, absent benchmarks,",
    "narrow scope, undisclosed cost/latency, rebranding, unstated failure modes).",
    "Then assign a severity 0-100 where 0 means 'no concern, looks real on this",
    "dimension' and 100 means 'maximal red flag, pure theater on this dimension'.",
    "If you genuinely have no evidence either way, say so in your reasoning and",
    "keep severity near the middle rather than inventing a strong signal.",
    "",
    "EXTRACTED ASSERTIONS:",
    ...extraction.assertions.map((a) => `- [${a.id}] ${a.text}`),
    "",
    renderInput(input),
  ].join("\n");

  const finding = await llm({
    system: RUBRIC_BLOCK,
    prompt,
    toolName: "record_skeptic_finding",
    toolDescription: `Record the skeptical findings for the ${dim.title} dimension.`,
    schema: SkepticFindingSchema,
    jsonSchema: zodToJsonSchema(SkepticFindingSchema),
  });

  // Guard: the model is told which dimension it owns; if it echoes a different
  // key, correct it rather than letting a mislabeled finding leak downstream.
  if (finding.dimension !== dimension) {
    return { ...finding, dimension };
  }
  return finding;
}
