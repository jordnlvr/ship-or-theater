# Ship or Theater — Design Spec (2026-05-31)

## Purpose
A CLI + library + MCP server that evaluates an AI claim/announcement/demo and renders a **scorecard**: a verdict (`SHIPS` / `MIXED` / `THEATER`), a 0–100 reality score, per-dimension scores, and the evidence — including the strongest *steelman* and the strongest *debunk*. The tool itself models responsible AI engineering (schema-validated structured output, adversarial verification, graceful degradation, no fabricated confidence).

## The rubric (the POV — fixed, weighted)
| # | Dimension | Weight | What it measures |
|---|---|---|---|
| 1 | Reproducibility | 0.20 | Could an independent party reproduce it, or is it a cherry-picked demo? |
| 2 | Evidence quality | 0.20 | Real benchmarks/data vs. screenshots and vibes |
| 3 | Scope honesty | 0.20 | Does it generalize, or is narrow/overfit dressed as general? |
| 4 | Production-readiness | 0.15 | Demo vs. deployable (latency, cost, reliability, governance) |
| 5 | Novelty | 0.10 | Genuine new capability or a wrapper/rebrand? |
| 6 | Hidden caveats | 0.15 | What's NOT said (failure modes, constraints, cost) |

Each dimension scored 0–100. Overall reality score = weighted mean of available dimensions. Verdict bands: **SHIPS ≥ 70 · MIXED 40–69 · THEATER < 40**.

## Architecture (multi-agent adversarial pipeline)
```
input: { claim: string, context?: string, sourceUrl?: string }
  → Extractor   : pull specific testable assertions from the input
  → Skeptic[6]  : PARALLEL, one agent per rubric dimension; each hunts for "theater"
  → Steelman    : argues the strongest defensible case FOR the claim
  → Judge       : weighs skeptics vs steelman → per-dimension score + reasoning + confidence
  → Scorecard   : compute overall score + verdict; render markdown + JSON
```

## Components (one purpose each)
- `types.ts` — zod schemas: `EvaluationInput`, `Assertion`, `DimensionFinding`, `JudgedDimension`, `Scorecard`. Single source of truth for shapes.
- `rubric.ts` — the 6 dimensions, weights, descriptions, verdict bands, scoring math (`computeScore`, `toVerdict`). Pure, fully unit-tested, no LLM.
- `llm.ts` — Anthropic client wrapper: structured-output call (tool-use forced to a zod-derived schema), **prompt caching** on the shared rubric/system block, one retry on invalid schema, model config. The ONLY file that talks to the API.
- `agents/extractor.ts`, `agents/skeptic.ts`, `agents/steelman.ts`, `agents/judge.ts` — each builds its prompt + calls `llm` + returns a validated typed result. Pure given an injected `llm` function (so tests pass a fake).
- `pipeline.ts` — orchestrates the flow; runs the 6 skeptics with `Promise.allSettled` (parallel, fault-tolerant); assembles the `Scorecard`. Takes an injected `llm` for testability.
- `scorecard.ts` — `renderMarkdown(scorecard)` + `toJSON`. Pure, unit-tested.
- `cli.ts` — `commander` CLI: `ship-or-theater "<claim>" [--context] [--url] [--json] [--out file]`. Reads `ANTHROPIC_API_KEY` from env.
- `mcp.ts` — MCP server (`@modelcontextprotocol/sdk`, stdio) exposing tools `evaluate_claim` and `get_rubric`.

## Data flow & error handling
- Every agent returns through a zod parse; on parse failure, `llm` retries once, then the agent throws.
- `pipeline` uses `allSettled` for the skeptic panel: a failed dimension is marked `inconclusive` (excluded from the weighted mean) rather than crashing the run. The judge receives whatever findings succeeded.
- No invented scores: a dimension with no usable evidence is `inconclusive`, never a guessed number.
- Determinism for tests: `llm` is injected; unit tests pass a fake `llm` returning fixed structured objects, so pipeline/scoring/rendering are fully tested **without** an API key. A documented `--live` smoke needs `ANTHROPIC_API_KEY`.

## Stack
TypeScript (ESM, Node ≥ 20) · `@anthropic-ai/sdk` (prompt caching) · `zod` (schema-validated structured output) · `@modelcontextprotocol/sdk` · `commander` · **vitest** (LLM layer mocked) · `tsup` build · published to npm as `ship-or-theater`.

## Testing strategy
- `rubric.test.ts` — weighting math, verdict banding, inconclusive-exclusion, edge cases (all inconclusive → no verdict).
- `scorecard.test.ts` — markdown + JSON rendering, including partial/inconclusive scorecards.
- `pipeline.test.ts` — with a fake `llm`: full happy path, one skeptic failing → inconclusive, all skeptics failing → graceful.
- `types.test.ts` — schema accept/reject.
- A test must fail without the code it covers.

## Out of scope (v0)
Web UI, scorecard archive site, multi-model providers, auth, persistence. (Documented as v0.2+.)

## Marketing surface
README (problem → approach → result + mermaid architecture diagram), 2 example scorecards (one real `SHIPS`, one real `THEATER`), a "how the rubric works" section (the POV). MIT license. The repo is the artifact and the seed for the "Ship or Theater?" content franchise.
