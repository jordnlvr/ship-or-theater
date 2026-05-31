import { writeFile } from "node:fs/promises";
import { Command } from "commander";
import { createClaudeCliLLM } from "./claude-cli-llm.js";
import { createLLM, type LLM, resolveModel } from "./llm.js";
import { evaluate } from "./pipeline.js";
import { renderMarkdown, toJSON } from "./scorecard.js";
import { EvaluationInputSchema } from "./types.js";

/**
 * CLI entry point. Runs the pipeline against a claim and prints (or writes) the
 * scorecard. Two providers:
 *   - "api"        : the Anthropic API (needs ANTHROPIC_API_KEY).
 *   - "claude-cli" : the local, already-authenticated `claude` CLI — runs on a
 *                    Claude subscription with NO API key.
 * Default "auto": use the API if a key is present, otherwise the claude CLI.
 */

type Provider = "auto" | "api" | "claude-cli";

interface CliOptions {
  context?: string;
  url?: string;
  json?: boolean;
  out?: string;
  model?: string;
  provider?: Provider;
}

/** Pick the LLM provider and a human-readable label for the scorecard. */
function selectProvider(
  options: CliOptions,
): { llm: LLM; modelLabel: string } | { error: string } {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const hasKey = Boolean(apiKey && apiKey.length > 0);
  const requested: Provider = options.provider ?? "auto";
  const provider: Exclude<Provider, "auto"> =
    requested === "auto" ? (hasKey ? "api" : "claude-cli") : requested;

  if (provider === "api") {
    if (!hasKey) {
      return {
        error:
          "Provider 'api' needs ANTHROPIC_API_KEY. Set it, or use --provider claude-cli to run on your Claude subscription.",
      };
    }
    const model = options.model ?? resolveModel();
    return { llm: createLLM({ apiKey, model }), modelLabel: model };
  }

  // claude-cli
  const model = options.model ?? "sonnet";
  return {
    llm: createClaudeCliLLM({ model }),
    modelLabel: `${model} (via Claude CLI / subscription)`,
  };
}

async function main(argv: string[]): Promise<void> {
  const program = new Command();

  program
    .name("ship-or-theater")
    .description(
      "Evaluate an AI claim against a fixed reality rubric and render a scorecard.",
    )
    .argument(
      "<claim>",
      "the AI claim, announcement, or demo description to evaluate",
    )
    .option("-c, --context <text>", "additional context surrounding the claim")
    .option("-u, --url <url>", "source URL for the claim")
    .option("-j, --json", "emit JSON instead of markdown", false)
    .option("-o, --out <file>", "write output to a file instead of stdout")
    .option(
      "-m, --model <model>",
      "override the model (default: SOT_MODEL or built-in)",
    )
    .option(
      "--provider <provider>",
      "api | claude-cli | auto (default: auto — API if ANTHROPIC_API_KEY is set, else the local claude CLI)",
      "auto",
    )
    .showHelpAfterError()
    .action(async (claim: string, options: CliOptions) => {
      const parsedInput = EvaluationInputSchema.safeParse({
        claim,
        context: options.context,
        sourceUrl: options.url,
      });
      if (!parsedInput.success) {
        process.stderr.write(
          `Invalid input: ${parsedInput.error.issues
            .map((i) => i.message)
            .join("; ")}\n`,
        );
        process.exitCode = 2;
        return;
      }

      const selected = selectProvider(options);
      if ("error" in selected) {
        process.stderr.write(`${selected.error}\n`);
        process.exitCode = 2;
        return;
      }

      const scorecard = await evaluate(selected.llm, parsedInput.data, {
        model: selected.modelLabel,
      });
      const output = options.json
        ? toJSON(scorecard)
        : renderMarkdown(scorecard);

      if (options.out) {
        await writeFile(options.out, output, "utf8");
        process.stderr.write(`Scorecard written to ${options.out}\n`);
      } else {
        process.stdout.write(output + "\n");
      }
    });

  await program.parseAsync(argv);
}

main(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`ship-or-theater failed: ${message}\n`);
  process.exitCode = 1;
});
