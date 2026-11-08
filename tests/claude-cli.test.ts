import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  assertSafeModel,
  CLAUDE_CLI_NOT_FOUND_MESSAGE,
  createClaudeCliLLM,
  DEFAULT_CLAUDE_CLI_TIMEOUT_MS,
  extractJson,
  resolveClaudeSpawn,
  runClaude,
} from "../src/claude-cli-llm.js";
import type { LLMRequest } from "../src/llm.js";

const TestSchema = z.object({ value: z.number(), echo: z.string().optional() });

const TEST_REQUEST: LLMRequest<{ value: number; echo?: string }> = {
  system: "system",
  prompt: 'Claim with "double quotes", \'single quotes\', and\nnewlines.',
  toolName: "record_test",
  toolDescription: "Record test output.",
  schema: TestSchema,
  jsonSchema: {
    type: "object",
    properties: { value: { type: "number" }, echo: { type: "string" } },
    required: ["value"],
  },
};

describe("extractJson (claude CLI output parsing)", () => {
  it("parses a fenced ```json block", () => {
    const text =
      'Here is the result:\n```json\n{"score": 42, "ok": true}\n```\nDone.';
    expect(extractJson(text)).toEqual({ score: 42, ok: true });
  });

  it("parses a bare object surrounded by prose", () => {
    const text = 'Sure — {"verdict":"THEATER","n":3} is my answer.';
    expect(extractJson(text)).toEqual({ verdict: "THEATER", n: 3 });
  });

  it("returns the outermost object when objects are nested", () => {
    const text = '{"a":1,"inner":{"b":2}}';
    expect(extractJson(text)).toEqual({ a: 1, inner: { b: 2 } });
  });

  it("handles braces inside string values", () => {
    const text = '{"note":"use {curly} braces","k":1}';
    expect(extractJson(text)).toEqual({ note: "use {curly} braces", k: 1 });
  });

  it("throws when there is no JSON object", () => {
    expect(() => extractJson("no json here, sorry")).toThrow(/no JSON object/i);
  });

  it("throws when the candidate slice is not valid JSON", () => {
    // Has braces but the content is not parseable JSON.
    expect(() => extractJson("{ not: valid, json }")).toThrow();
  });
});

describe("model name safety (cmd.exe expands %VAR% even inside quotes)", () => {
  it("accepts real model ids and aliases", () => {
    for (const m of ["sonnet", "opus", "claude-sonnet-5-5", "claude-opus-5-5[1m]", "us.anthropic.claude:1"]) {
      expect(() => assertSafeModel(m)).not.toThrow();
    }
  });

  it("rejects shell metacharacters and percent expansion", () => {
    for (const m of ["%SOT_X%", '" & echo pwned & rem "', "a|b", "a^b", "a b", "a\nb", ""]) {
      expect(() => assertSafeModel(m)).toThrow(/invalid model name/);
    }
  });

  it("runClaude rejects an unsafe model before spawning anything", async () => {
    await expect(
      runClaude("hi", { model: "%PATH%", bin: "definitely-not-a-real-binary" }),
    ).rejects.toThrow(/invalid model name/);
  });
});

describe("resolveClaudeSpawn (Windows .cmd and PATH resolution)", () => {
  it("resolves claude.cmd on win32 PATH and wraps in cmd.exe /d /s /c with quoted args", () => {
    const npmBin = "C:\\Users\\Jane Doe\\AppData\\Roaming\\npm";
    const cmdFile = win32.join(npmBin, "claude.cmd");
    const shFile = win32.join(npmBin, "claude");

    const resolved = resolveClaudeSpawn("claude", ["-p", "--model", "sonnet"], {
      platform: "win32",
      envPath: `C:\\Windows\\System32;${npmBin}`,
      comspec: "C:\\Windows\\System32\\cmd.exe",
      // Both extensionless `claude` (POSIX sh script) and `claude.cmd` exist;
      // win32 resolution must pick `claude.cmd`, never the extensionless sh script.
      isFile: (p) => p === cmdFile || p === shFile,
    });

    expect(resolved).not.toBeNull();
    expect(resolved?.command).toBe("C:\\Windows\\System32\\cmd.exe");
    expect(resolved?.windowsVerbatimArguments).toBe(true);
    expect(resolved?.args[0]).toBe("/d");
    expect(resolved?.args[1]).toBe("/s");
    expect(resolved?.args[2]).toBe("/c");
    expect(resolved?.args[3]).toContain(`"${cmdFile}"`);
    expect(resolved?.args[3]).toContain('"-p"');
    expect(resolved?.args[3]).toContain('"--model"');
    expect(resolved?.args[3]).toContain('"sonnet"');
  });

  it("refuses a .cmd path that cmd.exe would expand (%VAR%, quotes)", () => {
    for (const dir of ["C:\\%SOT_X%", 'C:\\a"b']) {
      const cmdFile = win32.join(dir, "claude.cmd");
      expect(() =>
        resolveClaudeSpawn("claude", ["-p"], {
          platform: "win32",
          envPath: dir,
          isFile: (p) => p === cmdFile,
        }),
      ).toThrow(/refusing to run claude CLI/);
    }
  });

  it("spawns claude.exe directly on win32 without cmd.exe wrapper", () => {
    const exePath = "C:\\Program Files\\Claude\\claude.exe";
    const resolved = resolveClaudeSpawn("claude", ["-p"], {
      platform: "win32",
      envPath: "C:\\Program Files\\Claude",
      isFile: (p) => p === exePath,
    });

    expect(resolved).toEqual({
      command: exePath,
      args: ["-p"],
    });
  });

  it("returns null on win32 when binary is missing from PATH", () => {
    const resolved = resolveClaudeSpawn("claude", ["-p"], {
      platform: "win32",
      envPath: "C:\\Windows\\System32",
      isFile: () => false,
    });
    expect(resolved).toBeNull();
  });

  it("keeps standard Per-call timeout at 180s", () => {
    expect(DEFAULT_CLAUDE_CLI_TIMEOUT_MS).toBe(180_000);
  });
});

describe("createClaudeCliLLM — missing binary & retry contract", () => {
  it("fails immediately without retrying when claude CLI is missing on PATH", async () => {
    const llm = createClaudeCliLLM({
      bin: "definitely-not-installed-claude-bin-xyz",
      envPath: "",
    });

    await expect(llm(TEST_REQUEST)).rejects.toThrow(
      CLAUDE_CLI_NOT_FOUND_MESSAGE,
    );
  });

  it("does not retry when the runner throws a non-retryable ENOENT error", async () => {
    let attempts = 0;
    const llm = createClaudeCliLLM({
      runner: async () => {
        attempts++;
        const err = new Error(
          CLAUDE_CLI_NOT_FOUND_MESSAGE,
        ) as NodeJS.ErrnoException;
        err.code = "ENOENT";
        throw err;
      },
    });

    await expect(llm(TEST_REQUEST)).rejects.toThrow(
      CLAUDE_CLI_NOT_FOUND_MESSAGE,
    );
    expect(attempts).toBe(1);
  });

  it("retries once on invalid JSON/schema output and succeeds on second attempt", async () => {
    let attempts = 0;
    const llm = createClaudeCliLLM({
      runner: async () => {
        attempts++;
        return attempts === 1 ? "not json at all" : '{"value": 42}';
      },
    });

    const res = await llm(TEST_REQUEST);
    expect(res).toEqual({ value: 42 });
    expect(attempts).toBe(2);
  });

  it(" executes a real subprocess shim and passes claims with quotes/newlines via stdin", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "sot-cli-test-"));
    try {
      const workerScript = join(tempDir, "fake-claude.mjs");
      await writeFile(
        workerScript,
        [
          'let data = "";',
          'process.stdin.setEncoding("utf8");',
          'process.stdin.on("data", (chunk) => (data += chunk));',
          'process.stdin.on("end", () => {',
          '  const hasQuotes = data.includes(\'"double quotes"\') && data.includes("\'single quotes\'");',
          '  const hasNewline = data.includes("and\\nnewlines.");',
          '  process.stdout.write(JSON.stringify({ value: hasQuotes && hasNewline ? 100 : 0 }));',
          "});",
        ].join("\n"),
        "utf8",
      );

      let binPath: string;
      if (process.platform === "win32") {
        binPath = join(tempDir, "fake-claude.cmd");
        await writeFile(
          binPath,
          `@echo off\r\n"${process.execPath}" "${workerScript}" %*\r\n`,
          "utf8",
        );
      } else {
        binPath = join(tempDir, "fake-claude.sh");
        await writeFile(
          binPath,
          `#!/bin/sh\nexec "${process.execPath}" "${workerScript}" "$@"\n`,
          { encoding: "utf8", mode: 0o755 },
        );
      }

      const llm = createClaudeCliLLM({ bin: binPath });
      const res = await llm(TEST_REQUEST);
      expect(res).toEqual({ value: 100 });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
