// Live smoke test: exercises the BUILT library against the selected provider
// (Anthropic API when ANTHROPIC_API_KEY is set, or the local `claude` CLI).
//   npm run build && npm run smoke
import { evaluate, renderMarkdown, selectProvider } from "../dist/index.js";

const selected = selectProvider();
if ("error" in selected) {
  console.error(selected.error);
  process.exit(1);
}

const CLAIM = {
  claim:
    "Our new agent autonomously fixed 80% of real GitHub issues in a private benchmark.",
  context: "From a product launch blog post; no public reproduction provided.",
};

console.error(`Running a live evaluation using ${selected.modelLabel}…`);
const scorecard = await evaluate(selected.llm, CLAIM, {
  model: selected.modelLabel,
});
console.log(renderMarkdown(scorecard));
