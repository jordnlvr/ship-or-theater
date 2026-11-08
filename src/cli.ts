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
  write: (chunk: string, callback?: (error?: Error | null) => void) => boolean;
  once?: (event: string, listener: (...args: unknown[]) => void) => unknown;
  off?: (event: string, listener: (...args: unknown[]) => void) => unknown;
}

export interface CliIO {
  stdout?: CliStream;
  stderr?: CliStream;
  env?: NodeJS.ProcessEnv;
  llmOverride?: LLM;
}

/**
 * Write a chunk to stdout and wait for both the write callback and stream
 * drain when backpressure occurs on a pipe or redirected file descriptor.
 */
export async function writeStdout(
  stream: CliStream,
  chunk: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let writeReturned = false;
    let writeDone = false;
    let drainDone = true;

    const cleanup = (keepErrorListener = false) => {
      if (typeof stream.off === "function") {
        stream.off("drain", onDrain);
        // On a failed write Node may call the write callback BEFORE it emits
        // 'error' (e.g. EPIPE). Keep the listener so that later emit is handled
        // instead of crashing the process as an uncaught stream error.
        if (!keepErrorListener) stream.off("error", onError);
      }
    };

    const finish = (err?: unknown) => {
      if (settled) return;
      if (err) {
        settled = true;
        cleanup(true);
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      if (writeReturned && writeDone && drainDone) {
        settled = true;
        cleanup();
        resolve();
      }
    };

    const onDrain = () => {
      drainDone = true;
      finish();
    };

    const onError = (err: unknown) => {
      finish(err ?? new Error("stdout stream error"));
    };

    if (typeof stream.once === "function") {
      stream.once("error", onError);
    }

    try {
      const expectsCallback = stream.write.length >= 2;
      const flushed = expectsCallback
        ? stream.write(chunk, (err) => {
            if (err) {
              finish(err);
              return;
            }
            writeDone = true;
            finish();
          })
        : stream.write(chunk);

      if (!expectsCallback) {
        writeDone = true;
      }

      if (!flushed && typeof stream.once === "function") {
        drainDone = false;
      }

      writeReturned = true;

      if (!drainDone && typeof stream.once === "function") {
        stream.once("drain", onDrain);
      }

      finish();
    } catch (err) {
      finish(err);
    }
  });
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
      "Paste in an AI claim you saw online and get a straight answer, with evidence: real (SHIPS), half-true (MIXED) or hype (THEATER).",
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
        try {
          if (options.out) {
            await writeFile(options.out, rubricText, "utf8");
            stderr.write(`Rubric written to ${options.out}\n`);
          } else {
            await writeStdout(stdout, rubricText + "\n");
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          stderr.write(`Failed to write output: ${message}\n`);
          exitCode = 1;
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

      try {
        if (options.out) {
          await writeFile(options.out, output, "utf8");
          stderr.write(`Scorecard written to ${options.out}\n`);
        } else {
          await writeStdout(stdout, output + "\n");
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        stderr.write(`Failed to write output: ${message}\n`);
        exitCode = 1;
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
