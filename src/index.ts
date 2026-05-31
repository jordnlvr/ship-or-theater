/**
 * Public API surface for ship-or-theater.
 *
 * Library consumers get the pipeline, the LLM factory, the rubric, the
 * scorecard renderers, and the zod schemas / types. The CLI and MCP server are
 * separate entry points (see package.json `bin`).
 */

export { evaluate, pickStrongestDebunk } from "./pipeline.js";
export type { EvaluateOptions } from "./pipeline.js";

export { createLLM, DEFAULT_MODEL, resolveModel } from "./llm.js";
export type { LLM, LLMRequest, CreateLLMOptions } from "./llm.js";

export {
  RUBRIC,
  TOTAL_WEIGHT,
  VERDICT_BANDS,
  computeScore,
  countUsable,
  getDimension,
  toVerdict,
} from "./rubric.js";
export type { RubricDimension } from "./rubric.js";

export { renderMarkdown, toJSON } from "./scorecard.js";

export { runExtractor } from "./agents/extractor.js";
export { runSkeptic } from "./agents/skeptic.js";
export { runSteelman } from "./agents/steelman.js";
export { runJudge, normalizeJudgement } from "./agents/judge.js";

export { zodToJsonSchema } from "./jsonschema.js";

export {
  DIMENSION_KEYS,
  DimensionKeySchema,
  EvaluationInputSchema,
  AssertionSchema,
  ExtractionSchema,
  SkepticFindingSchema,
  SteelmanSchema,
  JudgedDimensionSchema,
  JudgementSchema,
  ScorecardSchema,
  VERDICTS,
} from "./types.js";
export type {
  DimensionKey,
  EvaluationInput,
  Assertion,
  Extraction,
  SkepticFinding,
  Steelman,
  JudgedDimension,
  Judgement,
  Scorecard,
  Verdict,
} from "./types.js";
