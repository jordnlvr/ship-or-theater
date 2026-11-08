/**
 * Public API surface for ship-or-theater.
 *
 * Library consumers get the pipeline, the LLM factories, the provider selector,
 * the rubric, the scorecard & terminal renderers, and the zod schemas / types.
 * The CLI and MCP server are separate entry points (see package.json `bin`).
 */

export { evaluate, pickStrongestDebunk } from "./pipeline.js";
export type {
  EvaluateOptions,
  PipelineStage,
  ProgressEvent,
} from "./pipeline.js";

export { createLLM, DEFAULT_MODEL, resolveModel, VERSION } from "./llm.js";
export type { LLM, LLMRequest, CreateLLMOptions } from "./llm.js";

export {
  CLAUDE_CLI_NOT_FOUND_MESSAGE,
  ClaudeCliNotFoundError,
  createClaudeCliLLM,
  DEFAULT_CLAUDE_CLI_TIMEOUT_MS,
  extractJson,
  resolveClaudeSpawn,
  runClaude,
} from "./claude-cli-llm.js";
export type { ClaudeCliOptions, ResolvedClaudeSpawn } from "./claude-cli-llm.js";

export { PROVIDERS, selectProvider } from "./provider.js";
export type {
  ActiveProvider,
  Provider,
  ProviderSelection,
  SelectProviderOptions,
} from "./provider.js";

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

export { renderMarkdown, toJSON, VERDICT_GLOSS } from "./scorecard.js";

export {
  createProgressReporter,
  formatProgressLine,
  renderRubric,
  renderTerminal,
  resolveOutputFormat,
  shouldUseColor,
  stripAnsi,
  wrapText,
} from "./terminal.js";
export type { OutputFormat, RenderTerminalOptions } from "./terminal.js";

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
