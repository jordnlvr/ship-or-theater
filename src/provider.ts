import {
  createClaudeCliLLM,
  type ClaudeCliOptions,
} from "./claude-cli-llm.js";
import { createLLM, DEFAULT_MODEL, type LLM } from "./llm.js";

/**
 * Shared provider resolution used by both the CLI (`ship-or-theater`) and the
 * MCP server (`ship-or-theater-mcp`).
 *
 * Supports three modes via `--provider` or `SOT_PROVIDER`:
 *   - "auto" (default): use the Anthropic API if `ANTHROPIC_API_KEY` is set,
 *                       otherwise fall back to the local `claude` CLI.
 *   - "api"           : require `ANTHROPIC_API_KEY` and call the Anthropic API.
 *   - "claude-cli"    : shell out to the local `claude` CLI (no API key needed).
 */

export const PROVIDERS = ["auto", "api", "claude-cli"] as const;
export type Provider = (typeof PROVIDERS)[number];
export type ActiveProvider = Exclude<Provider, "auto">;

export interface SelectProviderOptions {
  /** Explicit provider ("auto" | "api" | "claude-cli"). Defaults to SOT_PROVIDER or "auto". */
  provider?: string;
  /** Explicit model override. Defaults to SOT_MODEL or the provider's default. */
  model?: string;
  /** Explicit API key override. Defaults to ANTHROPIC_API_KEY. */
  apiKey?: string;
  /** Environment dictionary to inspect (defaults to process.env). */
  env?: NodeJS.ProcessEnv;
  /** Optional overrides passed to createClaudeCliLLM (useful for testing). */
  claudeCliOptions?: ClaudeCliOptions;
}

export type ProviderSelection =
  | {
      llm: LLM;
      provider: ActiveProvider;
      model: string;
      modelLabel: string;
    }
  | { error: string };

export function selectProvider(
  options: SelectProviderOptions = {},
): ProviderSelection {
  const env = options.env ?? process.env;
  const apiKey = (options.apiKey ?? env.ANTHROPIC_API_KEY)?.trim();
  const hasKey = Boolean(apiKey && apiKey.length > 0);

  const rawProvider = (
    options.provider ??
    env.SOT_PROVIDER ??
    "auto"
  )
    .trim()
    .toLowerCase();

  if (
    rawProvider !== "auto" &&
    rawProvider !== "api" &&
    rawProvider !== "claude-cli"
  ) {
    return {
      error: `Invalid provider "${rawProvider}". Expected one of: auto, api, claude-cli.`,
    };
  }

  const provider: ActiveProvider =
    rawProvider === "auto" ? (hasKey ? "api" : "claude-cli") : rawProvider;

  const envModel = env.SOT_MODEL?.trim();
  const explicitModel = options.model?.trim() || envModel;

  if (provider === "api") {
    if (!hasKey) {
      return {
        error:
          "Provider 'api' needs ANTHROPIC_API_KEY. Set it, or use --provider claude-cli (or SOT_PROVIDER=claude-cli) to run on your Claude subscription.",
      };
    }
    const model =
      explicitModel && explicitModel.length > 0 ? explicitModel : DEFAULT_MODEL;
    return {
      llm: createLLM({ apiKey, model }),
      provider: "api",
      model,
      modelLabel: model,
    };
  }

  const model =
    explicitModel && explicitModel.length > 0 ? explicitModel : "sonnet";
  return {
    llm: createClaudeCliLLM({ ...options.claudeCliOptions, model }),
    provider: "claude-cli",
    model,
    modelLabel: `${model} (via Claude CLI / subscription)`,
  };
}
