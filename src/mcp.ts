import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { VERSION } from "./llm.js";
import { evaluate } from "./pipeline.js";
import { selectProvider } from "./provider.js";
import { RUBRIC, VERDICT_BANDS } from "./rubric.js";
import { renderMarkdown, toJSON } from "./scorecard.js";
import { EvaluationInputSchema } from "./types.js";

/**
 * MCP server (stdio) exposing two tools:
 *   - evaluate_claim: run the full pipeline on a claim and return the scorecard.
 *   - get_rubric: return the fixed rubric and verdict bands (no LLM needed).
 *
 * Like the CLI, this entry point uses the shared `selectProvider()` helper so it
 * honours `SOT_PROVIDER` (`auto` default: Anthropic API when `ANTHROPIC_API_KEY`
 * is set, otherwise the local `claude` CLI).
 */

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "ship-or-theater",
    version: VERSION,
  });

  server.registerTool(
    "evaluate_claim",
    {
      title: "Evaluate an AI claim",
      description:
        "Paste in an AI claim you saw online and get a straight answer, with " +
        "evidence: real (SHIPS), half-true (MIXED) or hype (THEATER). " +
        "Evaluates the claim, announcement, or demo against the fixed reality " +
        "rubric and returns a scorecard (verdict, reality score, per-dimension " +
        "scores, strongest steelman, strongest debunk). Uses SOT_PROVIDER " +
        "(default 'auto': Anthropic API if ANTHROPIC_API_KEY is set, otherwise " +
        "the local `claude` CLI with no API key required).",
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
      const selected = selectProvider();
      if ("error" in selected) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: selected.error,
            },
          ],
        };
      }

      const input = EvaluationInputSchema.parse({
        claim: args.claim,
        context: args.context,
        sourceUrl: args.sourceUrl,
      });

      try {
        const scorecard = await evaluate(selected.llm, input, {
          model: selected.modelLabel,
        });

        const text =
          args.format === "json"
            ? toJSON(scorecard)
            : renderMarkdown(scorecard);

        return {
          content: [{ type: "text", text }],
          structuredContent: scorecard as unknown as Record<string, unknown>,
        };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          content: [{ type: "text", text: message }],
        };
      }
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

  return server;
}

async function main(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (!process.env.VITEST) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`ship-or-theater-mcp failed: ${message}\n`);
    process.exitCode = 1;
  });
}
