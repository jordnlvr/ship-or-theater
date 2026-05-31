import { z } from "zod";

/**
 * Minimal, dependency-free zod -> JSON Schema converter.
 *
 * It covers exactly the constructs the agent schemas use (object, array,
 * string, number with min/max, boolean, enum, nullable, optional). The output
 * is a Draft-07-style schema suitable for an Anthropic tool `input_schema`.
 *
 * Keeping this in-house avoids adding a heavy transitive dependency and keeps
 * the "structured output" contract honest: the same zod schema both shapes the
 * tool and validates the result.
 */
export function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  return convert(schema);
}

function convert(schema: z.ZodTypeAny): Record<string, unknown> {
  const def = schema._def;

  switch (def.typeName) {
    case z.ZodFirstPartyTypeKind.ZodObject: {
      const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
      const properties: Record<string, unknown> = {};
      const required: string[] = [];

      for (const [key, value] of Object.entries(shape)) {
        const field = value as z.ZodTypeAny;
        const { node, optional } = unwrapField(field);
        properties[key] = convert(node);
        if (!optional) required.push(key);
      }

      const result: Record<string, unknown> = {
        type: "object",
        properties,
        additionalProperties: false,
      };
      if (required.length > 0) result.required = required;
      return result;
    }

    case z.ZodFirstPartyTypeKind.ZodArray: {
      const inner = (schema as z.ZodArray<z.ZodTypeAny>).element;
      return { type: "array", items: convert(inner) };
    }

    case z.ZodFirstPartyTypeKind.ZodString: {
      return withDescription({ type: "string" }, def.description);
    }

    case z.ZodFirstPartyTypeKind.ZodNumber: {
      const node: Record<string, unknown> = { type: "number" };
      for (const check of def.checks ?? []) {
        if (check.kind === "min") node.minimum = check.value;
        if (check.kind === "max") node.maximum = check.value;
      }
      return withDescription(node, def.description);
    }

    case z.ZodFirstPartyTypeKind.ZodBoolean: {
      return withDescription({ type: "boolean" }, def.description);
    }

    case z.ZodFirstPartyTypeKind.ZodEnum: {
      return withDescription(
        { type: "string", enum: [...def.values] },
        def.description,
      );
    }

    case z.ZodFirstPartyTypeKind.ZodNullable: {
      const inner = convert(def.innerType as z.ZodTypeAny);
      const innerType = inner.type;
      if (typeof innerType === "string") {
        return { ...inner, type: [innerType, "null"] };
      }
      return { anyOf: [inner, { type: "null" }] };
    }

    case z.ZodFirstPartyTypeKind.ZodOptional: {
      return convert(def.innerType as z.ZodTypeAny);
    }

    case z.ZodFirstPartyTypeKind.ZodDefault: {
      return convert(def.innerType as z.ZodTypeAny);
    }

    default:
      throw new Error(
        `zodToJsonSchema: unsupported zod type "${String(def.typeName)}"`,
      );
  }
}

/** Strip Optional/Default wrappers, reporting whether the field was optional. */
function unwrapField(field: z.ZodTypeAny): {
  node: z.ZodTypeAny;
  optional: boolean;
} {
  let node = field;
  let optional = false;
  // Peel optional/default layers; a nullable stays as-is (it's a value type).
  while (
    node._def.typeName === z.ZodFirstPartyTypeKind.ZodOptional ||
    node._def.typeName === z.ZodFirstPartyTypeKind.ZodDefault
  ) {
    if (node._def.typeName === z.ZodFirstPartyTypeKind.ZodOptional) {
      optional = true;
    }
    node = node._def.innerType as z.ZodTypeAny;
  }
  return { node, optional };
}

function withDescription(
  node: Record<string, unknown>,
  description: string | undefined,
): Record<string, unknown> {
  if (description) node.description = description;
  return node;
}
