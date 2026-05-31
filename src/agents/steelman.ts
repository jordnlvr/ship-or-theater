import { zodToJsonSchema } from "../jsonschema.js";
import type { LLM } from "../llm.js";
import {
  type EvaluationInput,
  type Extraction,
  type Steelman,
  SteelmanSchema,
} from "../types.js";
import { RUBRIC_BLOCK, renderInput } from "./shared.js";

/**
 * Steelman: argues the strongest *defensible* case FOR the claim, so the judge
 * weighs the best version of both sides rather than a strawman. Honest steelman
 * only — it must not invent evidence. Pure given an injected `llm`.
 */
export async function runSteelman(
  llm: LLM,
  input: EvaluationInput,
  extraction: Extraction,
): Promise<Steelman> {
  const prompt = [
    "Argue the strongest DEFENSIBLE case for this claim being real and shipped.",
    "Steelman it: assume good faith, surface the most credible supporting points.",
    "But stay honest — do not invent benchmarks or evidence that isn't implied by",
    "the input. If the best case is weak, say the best case is weak.",
    "",
    "EXTRACTED ASSERTIONS:",
    ...extraction.assertions.map((a) => `- [${a.id}] ${a.text}`),
    "",
    renderInput(input),
  ].join("\n");

  return llm({
    system: RUBRIC_BLOCK,
    prompt,
    toolName: "record_steelman",
    toolDescription:
      "Record the strongest defensible case in favor of the claim.",
    schema: SteelmanSchema,
    jsonSchema: zodToJsonSchema(SteelmanSchema),
  });
}
