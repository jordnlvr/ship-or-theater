# Contributing to Ship or Theater

Thank you for your interest in contributing to `ship-or-theater`!

## Development Setup

Prerequisites:
- Node.js `>= 20`
- npm

Clone the repository and install dependencies:

```bash
git clone https://github.com/jordnlvr/ship-or-theater.git
cd ship-or-theater
npm ci
```

## Development Loop

All unit tests run deterministically against an injected fake LLM (`tests/fake-llm.ts`) and **require no API key and no network access**:

```bash
# Typecheck
npm run typecheck

# Run the test suite (no API key needed)
npm test

# Watch mode during development
npm run test:watch

# Build ESM + TypeScript declarations into dist/
npm run build
```

To test the built CLI locally with zero setup:

```bash
node dist/cli.js --version
node dist/cli.js rubric
```

To run a live evaluation against a real claim, either set `ANTHROPIC_API_KEY` or have [Claude Code](https://claude.com/claude-code) (`claude` CLI) authenticated on your machine:

```bash
node dist/cli.js "Our new agent autonomously resolved 80% of production incidents." --provider claude-cli
```

## Why the Rubric Is Fixed

`ship-or-theater` evaluates claims against six fixed, weighted dimensions defined in `src/rubric.ts`:

1. **Reproducibility** (`0.20`) — Could an independent party reproduce it, or is it a cherry-picked demo?
2. **Evidence quality** (`0.20`) — Real benchmarks/data vs. screenshots and vibes?
3. **Scope honesty** (`0.20`) — Does it generalize, or is narrow/overfit work dressed up as general?
4. **Production-readiness** (`0.15`) — Demo vs. deployable (latency, cost, reliability, governance)?
5. **Novelty** (`0.10`) — Genuine new capability or a wrapper/rebrand?
6. **Hidden caveats** (`0.15`) — What's NOT said (failure modes, constraints, cost)?

The rubric weights sum to `1.0` (`TOTAL_WEIGHT`), and the verdict bands (`SHIPS >= 70`, `MIXED 40–69`, `THEATER < 40`, `INCONCLUSIVE` when no dimension has usable evidence) are intentionally fixed so scorecards remain comparable across runs. Dimensions lacking usable evidence are marked `inconclusive` (`score: null`) and excluded from the renormalized weighted mean rather than guessed.

If you propose a change to prompts, schemas, or rendering:
1. Keep the LLM boundary injectable (`src/llm.ts` / `src/claude-cli-llm.ts`).
2. Add or update unit tests in `tests/`.
3. Ensure `npm run typecheck`, `npm test`, and `npm run build` pass before opening a pull request.
