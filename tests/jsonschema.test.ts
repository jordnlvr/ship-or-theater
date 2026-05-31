import { describe, expect, it } from "vitest";
import { z } from "zod";
import { zodToJsonSchema } from "../src/jsonschema.js";

/**
 * Direct tests for the hand-rolled zod -> JSON Schema converter. These pin the
 * exact emitted objects, so any regression in the converter (e.g. dropping the
 * "null" member of a nullable type, mis-handling min/max, or putting an optional
 * field into `required`) fails loudly.
 */
describe("zodToJsonSchema", () => {
  it("converts a nullable, bounded number to a union type with min/max", () => {
    const schema = z.object({
      score: z.number().min(0).max(100).nullable(),
    });

    expect(zodToJsonSchema(schema)).toEqual({
      type: "object",
      additionalProperties: false,
      properties: {
        score: { type: ["number", "null"], minimum: 0, maximum: 100 },
      },
      required: ["score"],
    });
  });

  it("converts an enum to a string with the exact value list", () => {
    const schema = z.object({
      verdict: z.enum(["SHIPS", "MIXED", "THEATER"]),
    });

    expect(zodToJsonSchema(schema)).toEqual({
      type: "object",
      additionalProperties: false,
      properties: {
        verdict: { type: "string", enum: ["SHIPS", "MIXED", "THEATER"] },
      },
      required: ["verdict"],
    });
  });

  it("omits optional fields from `required` but keeps nullable-required ones", () => {
    const schema = z.object({
      // Required even though its value may be null.
      score: z.number().min(0).max(100).nullable(),
      // Optional -> must NOT appear in `required`.
      note: z.string().optional(),
    });

    const result = zodToJsonSchema(schema);

    expect(result.required).toEqual(["score"]);
    expect(result).toEqual({
      type: "object",
      additionalProperties: false,
      properties: {
        score: { type: ["number", "null"], minimum: 0, maximum: 100 },
        note: { type: "string" },
      },
      required: ["score"],
    });
  });
});
