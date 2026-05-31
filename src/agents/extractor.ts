import { zodToJsonSchema } from "../jsonschema.js";
import type { LLM } from "../llm.js";
import {
  type EvaluationInput,
  type Extraction,
  ExtractionSchema,
} from "../types.js";
import { RUBRIC_BLOCK, renderInput } from "./shared.js";

/**
 * Extractor: pulls the specific, testable assertions out of the raw claim so
 * the rest of the pipeline reasons about concrete statements rather than
 * marketing prose. Pure given an injected `llm`.
 */
export async function runExtractor(
  llm: LLM,
  input: EvaluationInput,
): Promise<Extraction> {
  const prompt = [
    "Extract the discrete, individually testable assertions from the claim below.",
    "Do not evaluate them yet — just isolate what is actually being asserted.",
    "For each assertion: give it a short id (a1, a2, ...), the assertion text,",
    "whether it is empirically testable, and which rubric dimensions it bears on.",
    "Also write a one-paragraph neutral summary of what is being claimed overall.",
    "",
    renderInput(input),
  ].join("\n");

  return llm({
    system: RUBRIC_BLOCK,
    prompt,
    toolName: "record_extraction",
    toolDescription:
      "Record the testable assertions extracted from the claim and a neutral summary.",
    schema: ExtractionSchema,
    jsonSchema: zodToJsonSchema(ExtractionSchema),
  });
}
