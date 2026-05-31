import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createLLM, resolveModel } from "./llm.js";
import { evaluate } from "./pipeline.js";
import { RUBRIC, VERDICT_BANDS } from "./rubric.js";
import { renderMarkdown, toJSON } from "./scorecard.js";
import { EvaluationInputSchema } from "./types.js";

/**
 * MCP server (stdio) exposing two tools:
 *   - evaluate_claim: run the full pipeline on a claim and return the scorecard.
 *   - get_rubric: return the fixed rubric and verdict bands (no LLM needed).
 *
 * Like the CLI, this is an entry point that constructs a real LLM. The pipeline
 * itself remains LLM-injected and unit-testable.
 */

const server = new McpServer({
  name: "ship-or-theater",
  version: "0.1.0",
});

server.registerTool(
  "evaluate_claim",
  {
    title: "Evaluate an AI claim",
    description:
      "Evaluate an AI claim, announcement, or demo against the fixed reality " +
      "rubric and return a scorecard (verdict, reality score, per-dimension " +
      "scores, strongest steelman, strongest debunk). Requires ANTHROPIC_API_KEY.",
    inputSchema: {
      claim: z.string().min(1).describe("The AI claim or demo to evaluate."),
      context: z
        .string()
        .optional()
        .describe("Optional surrounding context for the claim."),
      sourceUrl: z
        .string()
        .url()
        .optional()
        .describe("Optional source URL for the claim."),
      format: z
        .enum(["markdown", "json"])
        .optional()
        .describe("Output format; defaults to markdown."),
    },
  },
  async (args) => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey || apiKey.length === 0) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: "ANTHROPIC_API_KEY is not set in the MCP server environment.",
          },
        ],
      };
    }

    const input = EvaluationInputSchema.parse({
      claim: args.claim,
      context: args.context,
      sourceUrl: args.sourceUrl,
    });

    const model = resolveModel();
    const llm = createLLM({ apiKey, model });
    const scorecard = await evaluate(llm, input, { model });

    const text =
      args.format === "json" ? toJSON(scorecard) : renderMarkdown(scorecard);

    return {
      content: [{ type: "text", text }],
      structuredContent: scorecard as unknown as Record<string, unknown>,
    };
  },
);

server.registerTool(
  "get_rubric",
  {
    title: "Get the rubric",
    description:
      "Return the fixed, weighted reality rubric (six dimensions and weights) " +
      "and the verdict band thresholds. No API key required.",
    inputSchema: {},
  },
  async () => {
    const rubric = {
      dimensions: RUBRIC.map((d) => ({
        index: d.index,
        key: d.key,
        title: d.title,
        weight: d.weight,
        question: d.question,
      })),
      verdictBands: {
        SHIPS: `>= ${VERDICT_BANDS.shipsMin}`,
        MIXED: `${VERDICT_BANDS.mixedMin}-${VERDICT_BANDS.shipsMin - 1}`,
        THEATER: `< ${VERDICT_BANDS.mixedMin}`,
      },
    };
    return {
      content: [{ type: "text", text: JSON.stringify(rubric, null, 2) }],
      structuredContent: rubric,
    };
  },
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`ship-or-theater-mcp failed: ${message}\n`);
  process.exitCode = 1;
});
