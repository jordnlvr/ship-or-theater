import { RUBRIC } from "../rubric.js";
import type { EvaluationInput } from "../types.js";

/**
 * Shared prompt fragments used across agents. The rubric block is identical for
 * every agent in a run, so it is sent as the cacheable `system` text and hits
 * the prompt cache on repeated calls.
 */

export const PERSONA =
  "You are a rigorous, skeptical AI-claims evaluator. You separate real, " +
  "shipped capability from demo theater. You never inflate, never invent " +
  "evidence, and you are explicit about uncertainty. When evidence is absent, " +
  "you say so rather than guessing.";

/** The full rubric, rendered once, used as the cacheable system block. */
export const RUBRIC_BLOCK = [
  PERSONA,
  "",
  "You evaluate claims against this fixed, weighted rubric:",
  ...RUBRIC.map(
    (d) => `${d.index}. ${d.title} (weight ${d.weight}) — ${d.question}`,
  ),
  "",
  "Scoring convention: each dimension is 0-100 where 100 means the claim is " +
    "fully real/credible on that dimension and 0 means pure theater. If you " +
    "lack any usable evidence for a dimension, mark it inconclusive rather " +
    "than guessing a number.",
].join("\n");

/** Render the caller's input into a stable, labeled block for any agent. */
export function renderInput(input: EvaluationInput): string {
  const lines = [`CLAIM:\n${input.claim}`];
  if (input.context && input.context.trim().length > 0) {
    lines.push(`\nCONTEXT:\n${input.context}`);
  }
  if (input.sourceUrl) {
    lines.push(`\nSOURCE URL:\n${input.sourceUrl}`);
  }
  return lines.join("\n");
}
