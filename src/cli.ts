import { writeFile } from "node:fs/promises";
import { Command } from "commander";
import { createLLM, resolveModel } from "./llm.js";
import { evaluate } from "./pipeline.js";
import { renderMarkdown, toJSON } from "./scorecard.js";
import { EvaluationInputSchema } from "./types.js";

/**
 * CLI entry point. Reads ANTHROPIC_API_KEY from the environment, runs the
 * pipeline against a claim, and prints (or writes) the scorecard as markdown or
 * JSON. This is the only place besides mcp.ts that constructs a real LLM.
 */

interface CliOptions {
  context?: string;
  url?: string;
  json?: boolean;
  out?: string;
  model?: string;
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

      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey || apiKey.length === 0) {
        process.stderr.write(
          "ANTHROPIC_API_KEY is not set. Export it before running the CLI.\n",
        );
        process.exitCode = 2;
        return;
      }

      const model = options.model ?? resolveModel();
      const llm = createLLM({ apiKey, model });

      const scorecard = await evaluate(llm, parsedInput.data, { model });
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
