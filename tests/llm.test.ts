import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  createLLM,
  DEFAULT_MODEL,
  type LLMRequest,
  readPackageVersion,
  resolveModel,
  VERSION,
} from "../src/llm.js";
import { selectProvider } from "../src/provider.js";

/**
 * Tests for the createLLM retry loop, default model resolution, and shared
 * provider selector (`selectProvider`).
 */

const Schema = z.object({ value: z.number() });

const REQUEST: LLMRequest<{ value: number }> = {
  system: "system",
  prompt: "prompt",
  toolName: "record_value",
  toolDescription: "Record a value.",
  schema: Schema,
  jsonSchema: { type: "object", properties: { value: { type: "number" } } },
};

function makeFakeClient(inputs: unknown[]) {
  const calls: unknown[] = [];
  const client = {
    messages: {
      create: async (params: unknown) => {
        const input = inputs[calls.length];
        calls.push(params);
        return {
          content: [{ type: "tool_use", name: REQUEST.toolName, input }],
        };
      },
    },
  };
  return { client: client as unknown as never, calls };
}

describe("DEFAULT_MODEL and VERSION", () => {
  it("defaults to claude-sonnet-5-5 and honors SOT_MODEL override", () => {
    expect(DEFAULT_MODEL).toBe("claude-sonnet-5-5");
    const prev = process.env.SOT_MODEL;
    try {
      delete process.env.SOT_MODEL;
      expect(resolveModel()).toBe("claude-sonnet-5-5");
      process.env.SOT_MODEL = "claude-opus-4-6";
      expect(resolveModel()).toBe("claude-opus-4-6");
    } finally {
      if (prev === undefined) delete process.env.SOT_MODEL;
      else process.env.SOT_MODEL = prev;
    }
  });

  it("keeps VERSION in sync with package.json", () => {
    const pkg = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version: string };
    expect(VERSION).toBe("1.0.2");
    expect(VERSION).toBe(pkg.version);
    expect(readPackageVersion(new URL("../package.json", import.meta.url))).toBe(
      pkg.version,
    );
    expect(
      readPackageVersion(new URL("../nonexistent-package.json", import.meta.url)),
    ).toBe("1.0.1");
  });
});

describe("selectProvider (shared CLI + MCP provider resolution)", () => {
  it("defaults to claude-cli when ANTHROPIC_API_KEY is not set", () => {
    const selected = selectProvider({ env: {} });
    expect("error" in selected).toBe(false);
    if (!("error" in selected)) {
      expect(selected.provider).toBe("claude-cli");
      expect(selected.model).toBe("sonnet");
      expect(selected.modelLabel).toContain("Claude CLI");
    }
  });

  it("defaults to api with claude-sonnet-5-5 when ANTHROPIC_API_KEY is set", () => {
    const selected = selectProvider({
      env: { ANTHROPIC_API_KEY: "sk-ant-test-key" },
    });
    expect("error" in selected).toBe(false);
    if (!("error" in selected)) {
      expect(selected.provider).toBe("api");
      expect(selected.model).toBe("claude-sonnet-5-5");
      expect(selected.modelLabel).toBe("claude-sonnet-5-5");
    }
  });

  it("honors SOT_PROVIDER=claude-cli even when ANTHROPIC_API_KEY is set", () => {
    const selected = selectProvider({
      env: {
        ANTHROPIC_API_KEY: "sk-ant-test-key",
        SOT_PROVIDER: "claude-cli",
      },
    });
    expect("error" in selected).toBe(false);
    if (!("error" in selected)) {
      expect(selected.provider).toBe("claude-cli");
    }
  });

  it("returns an error when provider is 'api' and ANTHROPIC_API_KEY is missing", () => {
    const selected = selectProvider({
      env: { SOT_PROVIDER: "api" },
    });
    expect("error" in selected).toBe(true);
    if ("error" in selected) {
      expect(selected.error).toContain("ANTHROPIC_API_KEY");
    }
  });

  it("returns an error on an unknown SOT_PROVIDER value", () => {
    const selected = selectProvider({
      env: { SOT_PROVIDER: "invalid-provider" },
    });
    expect("error" in selected).toBe(true);
    if ("error" in selected) {
      expect(selected.error).toContain("Invalid provider");
    }
  });
});

describe("createLLM retry loop", () => {
  it("retries once on an invalid response, then returns the valid one", async () => {
    const { client, calls } = makeFakeClient([
      { value: "nope" },
      { value: 42 },
    ]);
    const llm = createLLM({ client });

    const result = await llm(REQUEST);

    expect(result).toEqual({ value: 42 });
    expect(calls).toHaveLength(2);
  });

  it("throws after the retry when both responses are invalid", async () => {
    const { client, calls } = makeFakeClient([
      { value: "bad" },
      { value: "still-bad" },
    ]);
    const llm = createLLM({ client });

    await expect(llm(REQUEST)).rejects.toThrow(/schema validation/i);
    expect(calls).toHaveLength(2);
  });
});
