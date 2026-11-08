import { writeFile } from "node:fs/promises";
import { Command } from "commander";
import { type LLM, VERSION } from "./llm.js";
import { evaluate } from "./pipeline.js";
import { type Provider, selectProvider } from "./provider.js";
import { renderMarkdown, toJSON } from "./scorecard.js";
import {
  createProgressReporter,
  renderRubric,
  renderTerminal,
  resolveOutputFormat,
  shouldUseColor,
} from "./terminal.js";
import { EvaluationInputSchema } from "./types.js";

/**
 * CLI entry point. Runs the pipeline against a claim and prints (or writes) the
 * scorecard, or prints the fixed reality rubric with zero setup (`rubric` / `--rubric`).
 */

interface CliOptions {
  context?: string;
  url?: string;
  json?: boolean;
  format?: string;
  color?: boolean;
  rubric?: boolean;
  out?: string;
  model?: string;
  provider?: Provider;
}

export interface CliStream {
  isTTY?: boolean;
  columns?: number;
  write: (chunk: string) => boolean;
}

export interface CliIO {
  stdout?: CliStream;
  stderr?: CliStream;
  env?: NodeJS.ProcessEnv;
  llmOverride?: LLM;
}

export async function runCli(
  argv: string[],
  io: CliIO = {},
): Promise<number> {
  const stdout: CliStream = io.stdout ?? process.stdout;
  const stderr: CliStream = io.stderr ?? process.stderr;
  const env: NodeJS.ProcessEnv = io.env ?? process.env;

  let exitCode = 0;
  const program = new Command();

  program
    .name("ship-or-theater")
    .version(VERSION, "-V, --version", "print the package version")
    .description(
      "Evaluate an AI claim against a fixed reality rubric and render a scorecard.",
    )
    .argument(
      "[claim]",
      "the AI claim, announcement, or demo description to evaluate (or 'rubric' to print the fixed rubric)",
    )
    .option("-c, --context <text>", "additional context surrounding the claim")
    .option("-u, --url <url>", "source URL for the claim")
    .option(
      "-f, --format <format>",
      "output format: pretty | markdown | json (default: pretty in TTY, markdown otherwise)",
    )
    .option("-j, --json", "emit JSON output (shorthand for --format json)", false)
    .option("--no-color", "disable ANSI colors in terminal output")
    .option(
      "--rubric",
      "print the fixed reality rubric and verdict bands (no model or API key required)",
      false,
    )
    .option("-o, --out <file>", "write output to a file instead of stdout")
    .option(
      "-m, --model <model>",
      "override the model (default: SOT_MODEL or built-in)",
    )
    .option(
      "--provider <provider>",
      "api | claude-cli | auto (default: SOT_PROVIDER or auto — API if ANTHROPIC_API_KEY is set, else the local claude CLI)",
    )
    .addHelpText(
      "after",
      "\nSubcommands:\n  rubric                  print the fixed reality rubric and verdict bands (no model required)\n",
    )
    .configureOutput({
      writeOut: (str) => stdout.write(str),
      writeErr: (str) => stderr.write(str),
    })
    .exitOverride()
    .action(async (claim: string | undefined, options: CliOptions) => {
      const formatResult = resolveOutputFormat({
        format: options.format,
        json: options.json,
        isTTY: Boolean(stdout.isTTY),
      });
      if (typeof formatResult === "object" && "error" in formatResult) {
        stderr.write(`${formatResult.error}\n`);
        exitCode = 2;
        return;
      }
      const format = formatResult;
      const useColor = shouldUseColor({
        colorFlag: options.color,
        env,
      });
      const width = stdout.columns ?? 80;

      // Zero-setup rubric command (`ship-or-theater rubric` or `ship-or-theater --rubric`).
      if (options.rubric || claim?.trim().toLowerCase() === "rubric") {
        const rubricText = renderRubric({
          format,
          color: useColor,
          width,
        });
        if (options.out) {
          await writeFile(options.out, rubricText, "utf8");
          stderr.write(`Rubric written to ${options.out}\n`);
        } else {
          stdout.write(rubricText + "\n");
        }
        return;
      }

      if (claim === undefined) {
        stderr.write(
          "Missing <claim> argument. Pass a claim to evaluate, or run `ship-or-theater rubric`.\n",
        );
        exitCode = 2;
        return;
      }

      const parsedInput = EvaluationInputSchema.safeParse({
        claim,
        context: options.context,
        sourceUrl: options.url,
      });
      if (!parsedInput.success) {
        stderr.write(
          `Invalid input: ${parsedInput.error.issues
            .map((i) => i.message)
            .join("; ")}\n`,
        );
        exitCode = 2;
        return;
      }

      const selected = io.llmOverride
        ? {
            llm: io.llmOverride,
            modelLabel: options.model ?? "test-model",
          }
        : selectProvider({
            provider: options.provider,
            model: options.model,
            env,
          });
      if ("error" in selected) {
        stderr.write(`${selected.error}\n`);
        exitCode = 2;
        return;
      }

      const progress = createProgressReporter(stderr, { color: useColor });
      let scorecard;
      try {
        scorecard = await evaluate(selected.llm, parsedInput.data, {
          model: selected.modelLabel,
          onProgress: progress.onProgress,
        });
      } finally {
        progress.clear();
      }

      const output =
        format === "json"
          ? toJSON(scorecard)
          : format === "pretty"
            ? renderTerminal(scorecard, { color: useColor, width })
            : renderMarkdown(scorecard);

      if (options.out) {
        await writeFile(options.out, output, "utf8");
        stderr.write(`Scorecard written to ${options.out}\n`);
      } else {
        stdout.write(output + "\n");
      }
    });

  try {
    await program.parseAsync(argv);
  } catch (err: unknown) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      typeof (err as { exitCode?: number }).exitCode === "number"
    ) {
      const cmdErr = err as { code: string; exitCode: number };
      if (
        cmdErr.code === "commander.helpDisplayed" ||
        cmdErr.code === "commander.version"
      ) {
        return 0;
      }
      return cmdErr.exitCode;
    }
    throw err;
  }

  return exitCode;
}

if (!process.env.VITEST) {
  runCli(process.argv)
    .then((code) => {
      if (code !== 0) process.exitCode = code;
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`ship-or-theater failed: ${message}\n`);
      process.exitCode = 1;
    });
}
