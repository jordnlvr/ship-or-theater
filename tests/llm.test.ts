import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createLLM, type LLMRequest } from "../src/llm.js";

/**
 * Tests for the createLLM retry loop using the injectable `client` option. No
 * network and no API key: we hand createLLM a fake Anthropic-like client whose
 * `messages.create` returns canned tool_use responses. This proves the
 * "one retry on invalid schema, then throw" contract from the real shape.
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

/** Build a fake client that yields the given tool inputs across successive calls. */
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
  // The createLLM signature wants an Anthropic instance; the fake only needs
  // messages.create, so cast through unknown.
  return { client: client as unknown as never, calls };
}

describe("createLLM retry loop", () => {
  it("retries once on an invalid response, then returns the valid one", async () => {
    // First response fails schema (value is a string), second succeeds.
    const { client, calls } = makeFakeClient([
      { value: "nope" },
      { value: 42 },
    ]);
    const llm = createLLM({ client });

    const result = await llm(REQUEST);

    expect(result).toEqual({ value: 42 });
    expect(calls).toHaveLength(2); // initial attempt + one retry
  });

  it("throws after the retry when both responses are invalid", async () => {
    const { client, calls } = makeFakeClient([
      { value: "bad" },
      { value: "still-bad" },
    ]);
    const llm = createLLM({ client });

    await expect(llm(REQUEST)).rejects.toThrow(/schema validation/i);
    expect(calls).toHaveLength(2); // initial attempt + one retry, then throw
  });
});
