#!/usr/bin/env node
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Gallery runner (`gallery/gallery.mjs`).
 *
 * Reads `gallery/claims.json`, evaluates each claim through the real pipeline
 * via the local `claude` CLI provider (or an injected LLM in tests), and writes:
 *   - `gallery/<slug>.json` (`{ meta, scorecard }`)
 *   - `gallery/<slug>.md`   (`renderMarkdown(scorecard)`)
 *   - `gallery/README.md`   (index table of all evaluated claims)
 *
 * Flags:
 *   --only <slug>       Run only the matching claim slug
 *   --concurrency <n>   Number of parallel claim evaluations (default: 2)
 *   --force             Re-run and overwrite slugs that already have <slug>.json
 *   --model <model>     Model passed to the provider (default: "sonnet")
 *   --provider <name>   Provider name recorded in meta (default: "claude-cli")
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

async function loadCore() {
  try {
    return await import("../dist/index.js");
  } catch {
    return await import("../src/index.ts");
  }
}

export function parseGalleryArgs(argv = process.argv.slice(2)) {
  let only = undefined;
  let concurrency = 2;
  let force = false;
  let model = "sonnet";
  let provider = "claude-cli";

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--only") {
      only = argv[++i];
    } else if (arg.startsWith("--only=")) {
      only = arg.slice("--only=".length);
    } else if (arg === "--concurrency") {
      const val = Number.parseInt(argv[++i] ?? "", 10);
      if (!Number.isFinite(val) || val < 1) {
        throw new Error(`Invalid --concurrency value: ${argv[i]}`);
      }
      concurrency = val;
    } else if (arg.startsWith("--concurrency=")) {
      const val = Number.parseInt(arg.slice("--concurrency=".length), 10);
      if (!Number.isFinite(val) || val < 1) {
        throw new Error(`Invalid --concurrency value: ${arg}`);
      }
      concurrency = val;
    } else if (arg === "--force") {
      force = true;
    } else if (arg === "--model") {
      model = argv[++i] ?? model;
    } else if (arg.startsWith("--model=")) {
      model = arg.slice("--model=".length);
    } else if (arg === "--provider") {
      provider = argv[++i] ?? provider;
    } else if (arg.startsWith("--provider=")) {
      provider = arg.slice("--provider=".length);
    }
  }

  return { only, concurrency, force, model, provider };
}

export function renderGalleryIndex(entries) {
  const lines = [
    "# Ship or Theater — Claim Gallery",
    "",
    "Real evaluations of public AI claims, announcements, and demos against the fixed reality rubric.",
    "",
    "| Title | Claimant | Verdict | Score | Link |",
    "|-------|----------|---------|-------|------|",
  ];

  for (const entry of entries) {
    const { meta, scorecard } = entry;
    const score =
      scorecard.overallScore === null ? "—" : `${scorecard.overallScore}/100`;
    const link = `[${meta.slug}.md](./${meta.slug}.md) · [json](./${meta.slug}.json)`;
    lines.push(
      `| ${meta.title} | ${meta.claimant} | **${scorecard.verdict}** | ${score} | ${link} |`,
    );
  }

  lines.push("");
  return lines.join("\n");
}

export async function runGallery(options = {}) {
  const {
    claimsPath = join(__dirname, "claims.json"),
    outDir = __dirname,
    pkgPath = join(REPO_ROOT, "package.json"),
    only,
    concurrency = 2,
    force = false,
    model = "sonnet",
    provider = "claude-cli",
    llm: injectedLlm,
    evaluateFn,
    renderMarkdownFn,
    now = () => new Date(),
    stderr = process.stderr,
  } = options;

  const pkgRaw = JSON.parse(await readFile(pkgPath, "utf8"));
  const toolVersion = pkgRaw.version;
  if (!toolVersion || typeof toolVersion !== "string") {
    throw new Error(`Could not read string "version" from ${pkgPath}`);
  }

  const claimsRaw = JSON.parse(await readFile(claimsPath, "utf8"));
  if (!Array.isArray(claimsRaw)) {
    throw new Error(`Expected ${claimsPath} to contain a JSON array of claims.`);
  }

  // Deduplicate by slug while preserving order so the queue never contains duplicate slugs.
  const seenSlugs = new Set();
  const allClaims = [];
  for (const item of claimsRaw) {
    if (!item || typeof item.slug !== "string" || item.slug.trim().length === 0) {
      throw new Error("Every claim in claims.json must have a non-empty string slug.");
    }
    if (seenSlugs.has(item.slug)) continue;
    seenSlugs.add(item.slug);
    allClaims.push(item);
  }

  const targetClaims = only
    ? allClaims.filter((c) => c.slug === only)
    : allClaims;

  if (only && targetClaims.length === 0) {
    throw new Error(`No claim found in ${claimsPath} with slug "${only}".`);
  }

  await mkdir(outDir, { recursive: true });

  const core =
    !injectedLlm || !evaluateFn || !renderMarkdownFn ? await loadCore() : null;
  const evalPipeline = evaluateFn ?? core.evaluate;
  const renderMd = renderMarkdownFn ?? core.renderMarkdown;
  const llm =
    injectedLlm ??
    (provider === "api"
      ? core.createLLM({ model })
      : core.createClaudeCliLLM({ model }));
  const modelLabel =
    provider === "claude-cli"
      ? `${model} (via Claude CLI / subscription)`
      : model;

  const skipped = [];
  const workQueue = [];

  for (const claim of targetClaims) {
    const jsonPath = join(outDir, `${claim.slug}.json`);
    if (!force && existsSync(jsonPath)) {
      skipped.push(claim.slug);
      continue;
    }
    workQueue.push(claim);
  }

  const succeeded = [];
  const failed = [];
  let cursor = 0;

  async function worker() {
    while (true) {
      const idx = cursor++;
      if (idx >= workQueue.length) break;
      const item = workQueue[idx];
      const jsonPath = join(outDir, `${item.slug}.json`);
      const mdPath = join(outDir, `${item.slug}.md`);

      try {
        const scorecard = await evalPipeline(
          llm,
          {
            claim: item.claim,
            context: item.context,
            sourceUrl: item.sourceUrl,
          },
          { model: modelLabel, now },
        );

        const record = {
          meta: {
            slug: item.slug,
            title: item.title,
            claimant: item.claimant,
            claimDate: item.claimDate,
            sourceUrl: item.sourceUrl,
            sources: Array.isArray(item.sources) ? item.sources : [],
            runAt: now().toISOString(),
            model,
            provider,
            toolVersion,
          },
          scorecard,
        };

        await writeFile(
          jsonPath,
          JSON.stringify(record, null, 2) + "\n",
          "utf8",
        );
        const markdown = renderMd(scorecard);
        await writeFile(
          mdPath,
          markdown.endsWith("\n") ? markdown : `${markdown}\n`,
          "utf8",
        );
        succeeded.push(item.slug);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        failed.push({ slug: item.slug, error: message });
        stderr.write(`[gallery] failed "${item.slug}": ${message}\n`);
      }
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, workQueue.length || 1));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  // Rebuild gallery/README.md from all completed <slug>.json files in claims.json order.
  const indexEntries = [];
  for (const claim of allClaims) {
    const jsonPath = join(outDir, `${claim.slug}.json`);
    if (existsSync(jsonPath)) {
      try {
        const parsed = JSON.parse(await readFile(jsonPath, "utf8"));
        if (parsed && parsed.meta && parsed.scorecard) {
          indexEntries.push(parsed);
        }
      } catch {
        /* ignore malformed partial file */
      }
    }
  }

  const indexMd = renderGalleryIndex(indexEntries);
  await writeFile(join(outDir, "README.md"), indexMd, "utf8");

  return { succeeded, skipped, failed, indexEntries };
}

const isMain =
  !process.env.VITEST &&
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  try {
    const args = parseGalleryArgs(process.argv.slice(2));
    const result = await runGallery(args);
    process.stderr.write(
      `[gallery] done: ${result.succeeded.length} succeeded, ${result.skipped.length} skipped, ${result.failed.length} failed.\n`,
    );
    if (result.failed.length > 0) {
      process.exitCode = 1;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[gallery] fatal: ${message}\n`);
    process.exitCode = 1;
  }
}
