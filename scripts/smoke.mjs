// Live smoke test: exercises the BUILT library against the real Anthropic API.
// Requires a real ANTHROPIC_API_KEY — this makes a genuine API call, no mocks.
//   npm run build && ANTHROPIC_API_KEY=... npm run smoke
import { createLLM, evaluate, renderMarkdown } from "../dist/index.js";

if (!process.env.ANTHROPIC_API_KEY) {
  console.error(
    "ANTHROPIC_API_KEY is not set. Set it and re-run: " +
      "npm run build && ANTHROPIC_API_KEY=... npm run smoke",
  );
  process.exit(1);
}

const CLAIM = {
  claim:
    "Our new agent autonomously fixed 80% of real GitHub issues in a private benchmark.",
  context: "From a product launch blog post; no public reproduction provided.",
};

const llm = createLLM();
console.error("Running a live evaluation against the real API…");
const scorecard = await evaluate(llm, CLAIM);
console.log(renderMarkdown(scorecard));
