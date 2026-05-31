import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import type { LLM, LLMRequest } from "./llm.js";

/**
 * An {@link LLM} provider that routes each agent call through the locally
 * installed, already-authenticated `claude` CLI (Claude Code) in print mode.
 *
 * Why this exists: the Anthropic *API* needs a separate API key with its own
 * billing. The `claude` CLI authenticates with a Claude *subscription*. This
 * provider lets anyone who has Claude Code installed run the evaluator with no
 * API key — it shells out to `claude -p`, asks for strict JSON, and validates
 * the result against the same zod schema every other provider uses.
 *
 * It does NOT import the Anthropic SDK; it only spawns a subprocess.
 */

export interface ClaudeCliOptions {
  /** Binary to invoke (default: "claude"). */
  bin?: string;
  /** Model alias/name passed to `claude --model` (default: "sonnet"). */
  model?: string;
  /** Per-call timeout in milliseconds (default: 180000). */
  timeoutMs?: number;
}

/** Run `claude -p` once, feeding the prompt on stdin, and return stdout. */
function runClaude(prompt: string, opts: ClaudeCliOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = ["-p"];
    if (opts.model) args.push("--model", opts.model);
    // Run from a neutral cwd so the CLI does not load a project's CLAUDE.md /
    // MCP config — we want a clean one-shot text generation.
    const child = spawn(opts.bin ?? "claude", args, {
      cwd: tmpdir(),
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("claude CLI timed out"));
    }, opts.timeoutMs ?? 180_000);

    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`claude exited ${code}: ${stderr.slice(0, 300)}`));
    });

    // If `claude` dies before reading stdin (crash, or a timeout-kill mid-write),
    // the write emits EPIPE on this separate stream. Without a listener Node would
    // throw it as an uncaught exception and bypass the retry/throw contract.
    child.stdin.on("error", () => {
      /* swallow; the 'close'/'error' handlers report the real cause */
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

/**
 * Pull a single JSON object out of the model's text. The CLI may wrap output in
 * a ```json fence or add prose; take the fenced block if present, else the
 * outermost `{ ... }`. Throws if no JSON object is found.
 */
export function extractJson(text: string): unknown {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence?.[1] ?? text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("no JSON object found in claude CLI output");
  }
  return JSON.parse(body.slice(start, end + 1));
}

/**
 * Build an {@link LLM} backed by the `claude` CLI. Mirrors the API provider's
 * contract: returns `request.schema`-validated data or throws, with exactly one
 * retry on an invalid/parse-failed response.
 */
export function createClaudeCliLLM(options: ClaudeCliOptions = {}): LLM {
  const opts: ClaudeCliOptions = { model: "sonnet", ...options };

  return async function llm<T>(request: LLMRequest<T>): Promise<T> {
    const base = `${request.system}\n\n${request.prompt}\n\nRespond with ONLY a single JSON object that satisfies this JSON Schema. No prose, no markdown fences, no commentary:\n${JSON.stringify(
      request.jsonSchema,
    )}`;

    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      const prompt =
        attempt === 0
          ? base
          : `${base}\n\nYour previous reply did not parse as the required JSON. Output ONLY the JSON object and nothing else.`;
      try {
        const text = await runClaude(prompt, opts);
        const json = extractJson(text);
        const parsed = request.schema.safeParse(json);
        if (parsed.success) return parsed.data;
        lastError = parsed.error;
      } catch (error) {
        lastError = error;
      }
    }

    throw new Error(
      `claude CLI response failed schema validation for tool "${request.toolName}" after retry: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
    );
  };
}
