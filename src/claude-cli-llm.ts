import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { win32 } from "node:path";
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

export const CLAUDE_CLI_NOT_FOUND_MESSAGE =
  "claude CLI not found on PATH. Install Claude Code (https://claude.com/claude-code) or set ANTHROPIC_API_KEY.";

export const DEFAULT_CLAUDE_CLI_TIMEOUT_MS = 180_000;

export class ClaudeCliNotFoundError extends Error {
  readonly code = "ENOENT";
  readonly noRetry = true;

  constructor(message = CLAUDE_CLI_NOT_FOUND_MESSAGE) {
    super(message);
    this.name = "ClaudeCliNotFoundError";
  }
}

/** Characters cmd.exe interprets even inside a quoted argument. */
export const UNSAFE_CMD_PATH = /[%"\r\n]/;

export class UnsafeClaudePathError extends Error {
  readonly noRetry = true;

  constructor(path: string) {
    super(
      `refusing to run claude CLI from ${JSON.stringify(path)}: the path contains %, a quote or a newline, which cmd.exe would interpret. Move Claude Code to a plain path or set ANTHROPIC_API_KEY.`,
    );
    this.name = "UnsafeClaudePathError";
  }
}

export interface ClaudeCliOptions {
  /** Binary to invoke (default: "claude"). */
  bin?: string;
  /** Model alias/name passed to `claude --model` (default: "sonnet"). */
  model?: string;
  /** Per-call timeout in milliseconds (default: 180000). */
  timeoutMs?: number;
  /** Optional PATH override (primarily for tests). */
  envPath?: string;
  /** Optional custom runner for deterministic unit tests. */
  runner?: (prompt: string, opts: ClaudeCliOptions) => Promise<string>;
}

export interface ResolvedClaudeSpawn {
  command: string;
  args: string[];
  windowsVerbatimArguments?: boolean;
}

function defaultIsFile(filePath: string): boolean {
  try {
    return existsSync(filePath) && statSync(filePath).isFile();
  } catch {
    return false;
  }
}

/**
 * Quote a single argument for `cmd.exe /d /s /c "<cmdLine>"`.
 * Prompts are always sent over stdin, never via command-line arguments,
 * so claims containing quotes or newlines never pass through cmd.exe parsing.
 */
export function quoteWin32CmdArg(arg: string): string {
  const escaped = arg.replace(/\r?\n/g, " ").replace(/"/g, '""');
  return `"${escaped}"`;
}

/**
 * Resolve how to spawn the `claude` CLI across platforms.
 *
 * On Windows (`win32`), npm global installs create `claude.cmd` (alongside a
 * POSIX `/bin/sh` script named `claude` with no extension). Node's `spawn`
 * with `shell: false` does not resolve `.cmd` shims and throws `EINVAL` if a
 * `.cmd` is spawned directly without `cmd.exe`. We locate the real `.exe` or
 * `.cmd`/`.bat` on `PATH` and wrap `.cmd`/`.bat` in `cmd.exe /d /s /c` with
 * `windowsVerbatimArguments: true`. Returns `null` when the binary cannot be
 * found on `PATH` so the caller fails fast with a clear, non-retried error.
 */
export function resolveClaudeSpawn(
  bin: string,
  cliArgs: readonly string[],
  options: {
    platform?: NodeJS.Platform;
    envPath?: string;
    comspec?: string;
    isFile?: (filePath: string) => boolean;
  } = {},
): ResolvedClaudeSpawn | null {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32") {
    return { command: bin, args: [...cliArgs] };
  }

  // Always use Windows path rules here, whatever the host OS, so the
  // resolver behaves the same in Linux/macOS CI as on a real Windows box.
  const { delimiter, join } = win32;
  const isFile = options.isFile ?? defaultIsFile;
  const envPath =
    options.envPath ?? process.env.PATH ?? process.env.Path ?? "";
  const winExts = [".exe", ".cmd", ".bat", ".com"];
  const lowerBin = bin.toLowerCase();
  const hasWinExt = winExts.some((ext) => lowerBin.endsWith(ext));
  const hasPathSep =
    bin.includes("/") || bin.includes("\\") || /^[a-zA-Z]:/.test(bin);

  let resolvedPath: string | null = null;

  if (hasPathSep) {
    const candidates = hasWinExt
      ? [bin]
      : [...winExts.map((ext) => `${bin}${ext}`), bin];
    for (const candidate of candidates) {
      if (isFile(candidate)) {
        resolvedPath = candidate;
        break;
      }
    }
  } else {
    const dirs = envPath
      .split(delimiter)
      .map((d) => d.trim().replace(/^"+|"+$/g, ""))
      .filter((d) => d.length > 0);

    outer: for (const dir of dirs) {
      const candidates = hasWinExt
        ? [join(dir, bin)]
        : winExts.map((ext) => join(dir, `${bin}${ext}`));
      for (const candidate of candidates) {
        if (isFile(candidate)) {
          resolvedPath = candidate;
          break outer;
        }
      }
    }
  }

  if (!resolvedPath) {
    return null;
  }

  const lowerResolved = resolvedPath.toLowerCase();
  if (lowerResolved.endsWith(".cmd") || lowerResolved.endsWith(".bat")) {
    // cmd.exe expands %VAR% (and treats quotes/newlines specially) even inside
    // quotes, so a path containing them cannot be passed through it safely.
    if (UNSAFE_CMD_PATH.test(resolvedPath)) {
      throw new UnsafeClaudePathError(resolvedPath);
    }
    const comspec = options.comspec ?? process.env.ComSpec ?? "cmd.exe";
    const innerCmd = [
      quoteWin32CmdArg(resolvedPath),
      ...cliArgs.map(quoteWin32CmdArg),
    ].join(" ");
    return {
      command: comspec,
      args: ["/d", "/s", "/c", `"${innerCmd}"`],
      windowsVerbatimArguments: true,
    };
  }

  return {
    command: resolvedPath,
    args: [...cliArgs],
  };
}

/**
 * Model names reach a command line, and on Windows `cmd.exe` expands `%VAR%`
 * even inside quotes. Allow only plain model ids and aliases.
 */
export const SAFE_MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:\-[\]]*$/;

export function assertSafeModel(model: string): void {
  if (!SAFE_MODEL_PATTERN.test(model)) {
    const err = new Error(
      `invalid model name ${JSON.stringify(model)}: use letters, digits, '.', '_', ':', '-', '[' or ']' only`,
    ) as Error & { noRetry?: boolean };
    err.noRetry = true;
    throw err;
  }
}

export function isNoRetryError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as { noRetry?: boolean; code?: string };
  return err.noRetry === true || err.code === "ENOENT";
}

/** Run `claude -p` once, feeding the prompt on stdin, and return stdout. */
export function runClaude(
  prompt: string,
  opts: ClaudeCliOptions = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const cliArgs = ["-p"];
    if (opts.model) {
      try {
        assertSafeModel(opts.model);
      } catch (error) {
        reject(error);
        return;
      }
      cliArgs.push("--model", opts.model);
    }

    const bin = opts.bin ?? "claude";
    const resolved = resolveClaudeSpawn(bin, cliArgs, {
      envPath: opts.envPath,
    });
    if (!resolved) {
      reject(new ClaudeCliNotFoundError());
      return;
    }

    // Strip CLAUDECODE nesting markers so running inside a Claude Code terminal
    // or agent session does not block the child `claude -p` invocation.
    const childEnv: NodeJS.ProcessEnv = { ...process.env };
    delete childEnv.CLAUDECODE;
    delete childEnv.CLAUDE_CODE_ENTRYPOINT;
    if (opts.envPath !== undefined) {
      childEnv.PATH = opts.envPath;
      childEnv.Path = opts.envPath;
    }

    // Run from a neutral cwd so the CLI does not load a project's CLAUDE.md /
    // MCP config — we want a clean one-shot text generation.
    const child = spawn(resolved.command, resolved.args, {
      cwd: tmpdir(),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      windowsVerbatimArguments: resolved.windowsVerbatimArguments,
      env: childEnv,
    });

    const timeoutMs = opts.timeoutMs ?? DEFAULT_CLAUDE_CLI_TIMEOUT_MS;
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      const timeoutErr = new Error(
        `claude CLI timed out after ${timeoutMs}ms`,
      ) as Error & { noRetry?: boolean };
      timeoutErr.noRetry = true;
      reject(timeoutErr);
    }, timeoutMs);

    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (e.code === "ENOENT") {
        reject(new ClaudeCliNotFoundError());
        return;
      }
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout);
      } else {
        const detail = (stderr.trim() || stdout.trim()).slice(0, 300);
        reject(new Error(`claude exited ${code}: ${detail}`));
      }
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
 * contract: returns `request.schema`-validated data or throws, with at most one
 * retry on an invalid/parse-failed response. Missing binary or timeout errors
 * fail fast without retrying.
 */
export function createClaudeCliLLM(options: ClaudeCliOptions = {}): LLM {
  const opts: ClaudeCliOptions = { model: "sonnet", ...options };
  const execRunner = opts.runner ?? runClaude;

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
        const text = await execRunner(prompt, opts);
        const json = extractJson(text);
        const parsed = request.schema.safeParse(json);
        if (parsed.success) return parsed.data;
        lastError = parsed.error;
      } catch (error) {
        if (isNoRetryError(error)) {
          throw error;
        }
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
