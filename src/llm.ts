import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

/**
 * The ONLY module that imports or talks to the Anthropic SDK.
 *
 * Everything downstream (agents, pipeline) depends on the `LLM` function type,
 * not on this implementation, so the entire system can be unit-tested with a
 * fake `llm` and no API key.
 */

/** Default model; override with the SOT_MODEL env var. */
export const DEFAULT_MODEL = "claude-sonnet-4-6";

export function resolveModel(): string {
  const fromEnv = process.env.SOT_MODEL?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_MODEL;
}

/** A single structured-output request. */
export interface LLMRequest<T> {
  /**
   * Shared, cacheable instruction block (the rubric / persona). Sent with
   * `cache_control: ephemeral` so repeated agent calls hit the prompt cache.
   */
  system: string;
  /** Per-call user instruction (the specific task + data). */
  prompt: string;
  /** Name of the forced tool the model must call. */
  toolName: string;
  /** Human description of what the tool captures. */
  toolDescription: string;
  /** zod schema the tool input must satisfy; the result is `schema.parse`d. */
  schema: z.ZodType<T>;
  /** JSON Schema for the tool's `input_schema` (derived from the zod shape). */
  jsonSchema: Record<string, unknown>;
}

/**
 * The injected dependency every agent uses. Given a request, return a value
 * validated against `request.schema`. Implementations must NOT return unparsed
 * data — the contract is "typed T or throw".
 */
export type LLM = <T>(request: LLMRequest<T>) => Promise<T>;

/** Tunables for the real Anthropic-backed implementation. */
export interface CreateLLMOptions {
  apiKey?: string;
  model?: string;
  maxTokens?: number;
  client?: Anthropic;
}

interface ToolUseBlock {
  type: "tool_use";
  name: string;
  input: unknown;
}

function extractToolInput(
  content: Anthropic.Messages.ContentBlock[],
  toolName: string,
): unknown {
  for (const block of content) {
    if (
      block.type === "tool_use" &&
      (block as ToolUseBlock).name === toolName
    ) {
      return (block as ToolUseBlock).input;
    }
  }
  return undefined;
}

/**
 * Build a real LLM function backed by the Anthropic API. Forces a single
 * tool-use call whose `input_schema` is the zod-derived JSON Schema, then
 * `schema.parse`s the result. On a schema/parse failure it retries exactly
 * once (the spec's "one retry on invalid schema"), then throws.
 */
export function createLLM(options: CreateLLMOptions = {}): LLM {
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!options.client && (!apiKey || apiKey.length === 0)) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Provide it via env or createLLM({ apiKey }).",
    );
  }

  const client = options.client ?? new Anthropic({ apiKey });
  const model = options.model ?? resolveModel();
  const maxTokens = options.maxTokens ?? 2048;

  return async function llm<T>(request: LLMRequest<T>): Promise<T> {
    const tool: Anthropic.Messages.Tool = {
      name: request.toolName,
      description: request.toolDescription,
      input_schema: request.jsonSchema as Anthropic.Messages.Tool.InputSchema,
    };

    let lastError: unknown;

    // Initial attempt + one retry on invalid schema (2 attempts total).
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await client.messages.create({
        model,
        max_tokens: maxTokens,
        // Shared rubric/persona block, marked cacheable so repeated agent
        // calls within a run hit the prompt cache.
        system: [
          {
            type: "text",
            text: request.system,
            cache_control: { type: "ephemeral" },
          },
        ],
        tools: [tool],
        tool_choice: { type: "tool", name: request.toolName },
        messages: [
          {
            role: "user",
            content:
              attempt === 0
                ? request.prompt
                : `${request.prompt}\n\nYour previous response did not match the required schema. Respond again, strictly satisfying the tool's input schema.`,
          },
        ],
      });

      const raw = extractToolInput(response.content, request.toolName);
      const parsed = request.schema.safeParse(raw);
      if (parsed.success) {
        return parsed.data;
      }
      lastError = parsed.error;
    }

    throw new Error(
      `LLM response failed schema validation for tool "${request.toolName}" after retry: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
    );
  };
}
