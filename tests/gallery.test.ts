import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseGalleryArgs, runGallery } from "../gallery/gallery.mjs";
import { evaluate } from "../src/pipeline.js";
import { renderMarkdown } from "../src/scorecard.js";
import { makeFakeLLM } from "./fake-llm.js";

const SAMPLE_CLAIMS = [
  {
    slug: "claim-alpha",
    title: "Alpha Autonomous Coding Launch",
    claimant: "Alpha Corp",
    claimDate: "2026-10-01",
    claim: "Alpha Agent resolves 90% of issues autonomously.",
    context: "Launch blog post with internal benchmark table.",
    sourceUrl: "https://example.com/alpha",
    sources: [{ title: "Alpha Blog", url: "https://example.com/alpha" }],
  },
  {
    slug: "claim-beta",
    title: "Beta Zero-Latency Reasoning",
    claimant: "Beta Labs",
    claimDate: "2026-10-15",
    claim: "Beta Model achieves 10x speedup with zero accuracy loss.",
    context: "Conference keynote demo.",
    sourceUrl: "https://example.com/beta",
    sources: [{ title: "Beta Keynote", url: "https://example.com/beta" }],
  },
  {
    slug: "claim-gamma",
    title: "Gamma Universal Debugger",
    claimant: "Gamma AI",
    claimDate: "2026-10-20",
    claim: "Fixes any memory leak automatically.",
    context: "Social media video clip.",
    sourceUrl: "https://example.com/gamma",
    sources: [{ title: "Gamma Clip", url: "https://example.com/gamma" }],
  },
];

describe("gallery/gallery.mjs", () => {
  it("parses --only, --concurrency, and --force flags", () => {
    expect(
      parseGalleryArgs(["--only", "claim-alpha", "--concurrency", "3", "--force"]),
    ).toEqual({
      only: "claim-alpha",
      concurrency: 3,
      force: true,
      model: "sonnet",
      provider: "claude-cli",
    });
  });

  it("concurrency: runs with --concurrency 2 and never evaluates or writes any slug twice", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "sot-gallery-test-"));
    try {
      const claimsPath = join(tempDir, "claims.json");
      const pkgPath = join(tempDir, "package.json");
      await writeFile(claimsPath, JSON.stringify(SAMPLE_CLAIMS, null, 2), "utf8");
      await writeFile(
        pkgPath,
        JSON.stringify({ name: "ship-or-theater", version: "1.0.0" }),
        "utf8",
      );

      const { llm } = makeFakeLLM();
      const evaluatedCounts = new Map<string, number>();

      const evaluateFn = async (
        injectedLlm: typeof llm,
        input: { claim: string; context?: string; sourceUrl?: string },
        opts: { model?: string; now?: () => Date },
      ) => {
        const key = input.sourceUrl ?? input.claim;
        evaluatedCounts.set(key, (evaluatedCounts.get(key) ?? 0) + 1);
        await new Promise((r) => setTimeout(r, 10));
        return evaluate(injectedLlm, input, opts);
      };

      const fixedDate = new Date("2026-11-07T18:00:00.000Z");
      const res = await runGallery({
        claimsPath,
        outDir: tempDir,
        pkgPath,
        concurrency: 2,
        llm,
        evaluateFn,
        renderMarkdownFn: renderMarkdown,
        now: () => fixedDate,
      });

      expect(res.succeeded.sort()).toEqual([
        "claim-alpha",
        "claim-beta",
        "claim-gamma",
      ]);
      expect(res.skipped).toEqual([]);
      expect(res.failed).toEqual([]);

      // Every claim was evaluated exactly once across the 2 concurrent workers.
      for (const claim of SAMPLE_CLAIMS) {
        expect(evaluatedCounts.get(claim.sourceUrl)).toBe(1);
        expect(existsSync(join(tempDir, `${claim.slug}.json`))).toBe(true);
        expect(existsSync(join(tempDir, `${claim.slug}.md`))).toBe(true);
      }

      const readme = await readFile(join(tempDir, "README.md"), "utf8");
      expect(readme).toContain("Alpha Autonomous Coding Launch");
      expect(readme).toContain("Beta Zero-Latency Reasoning");
      expect(readme).toContain("Gamma Universal Debugger");

      // Second run without --force skips all existing JSON files.
      const res2 = await runGallery({
        claimsPath,
        outDir: tempDir,
        pkgPath,
        concurrency: 2,
        llm,
        evaluateFn,
        renderMarkdownFn: renderMarkdown,
        now: () => fixedDate,
      });
      expect(res2.succeeded).toEqual([]);
      expect(res2.skipped.sort()).toEqual([
        "claim-alpha",
        "claim-beta",
        "claim-gamma",
      ]);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("freshness: stamps runAt, model, provider, and dynamic toolVersion from package.json", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "sot-gallery-fresh-"));
    try {
      const claimsPath = join(tempDir, "claims.json");
      const pkgPath = join(tempDir, "package.json");
      await writeFile(
        claimsPath,
        JSON.stringify([SAMPLE_CLAIMS[0]], null, 2),
        "utf8",
      );
      await writeFile(
        pkgPath,
        JSON.stringify({ name: "ship-or-theater", version: "9.8.7-dynamic" }),
        "utf8",
      );

      const { llm } = makeFakeLLM();
      const stamp = new Date("2026-11-07T22:30:00.000Z");

      await runGallery({
        claimsPath,
        outDir: tempDir,
        pkgPath,
        model: "sonnet-custom",
        provider: "claude-cli",
        llm,
        evaluateFn: evaluate,
        renderMarkdownFn: renderMarkdown,
        now: () => stamp,
      });

      const saved = JSON.parse(
        await readFile(join(tempDir, "claim-alpha.json"), "utf8"),
      );
      expect(saved.meta).toEqual({
        slug: "claim-alpha",
        title: "Alpha Autonomous Coding Launch",
        claimant: "Alpha Corp",
        claimDate: "2026-10-01",
        sourceUrl: "https://example.com/alpha",
        sources: [{ title: "Alpha Blog", url: "https://example.com/alpha" }],
        runAt: "2026-11-07T22:30:00.000Z",
        model: "sonnet-custom",
        provider: "claude-cli",
        toolVersion: "9.8.7-dynamic",
      });
      expect(saved.scorecard.verdict).toBe("MIXED");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("failure isolation: one slug failing does not stop the rest and is reported", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "sot-gallery-fail-"));
    try {
      const claimsPath = join(tempDir, "claims.json");
      const pkgPath = join(tempDir, "package.json");
      await writeFile(claimsPath, JSON.stringify(SAMPLE_CLAIMS, null, 2), "utf8");
      await writeFile(
        pkgPath,
        JSON.stringify({ name: "ship-or-theater", version: "1.0.0" }),
        "utf8",
      );

      const { llm } = makeFakeLLM();
      const errLogs: string[] = [];
      const evaluateFn = async (
        injectedLlm: typeof llm,
        input: { claim: string; context?: string; sourceUrl?: string },
        opts: { model?: string; now?: () => Date },
      ) => {
        if (input.sourceUrl === "https://example.com/beta") {
          throw new Error("simulated provider failure on beta");
        }
        return evaluate(injectedLlm, input, opts);
      };

      const res = await runGallery({
        claimsPath,
        outDir: tempDir,
        pkgPath,
        concurrency: 2,
        llm,
        evaluateFn,
        renderMarkdownFn: renderMarkdown,
        stderr: {
          write: (s: string) => {
            errLogs.push(s);
            return true;
          },
        },
      });

      expect(res.succeeded.sort()).toEqual(["claim-alpha", "claim-gamma"]);
      expect(res.failed).toEqual([
        {
          slug: "claim-beta",
          error: "simulated provider failure on beta",
        },
      ]);
      expect(existsSync(join(tempDir, "claim-alpha.json"))).toBe(true);
      expect(existsSync(join(tempDir, "claim-beta.json"))).toBe(false);
      expect(existsSync(join(tempDir, "claim-gamma.json"))).toBe(true);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
