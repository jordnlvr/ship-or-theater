import { describe, expect, it } from "vitest";
import { extractJson } from "../src/claude-cli-llm.js";

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
