// One-off generator: renders the two example scorecards using the real
// renderer so the format is guaranteed consistent. Content is hand-authored and
// plausible (not produced by a model run). Run: node examples/generate-examples.mjs
import { writeFileSync } from "node:fs";
import { renderMarkdown, computeScore, toVerdict } from "../dist/index.js";

// Compute the verdict + score from the dimensions via the real rubric math, so
// the examples are never hand-fabricated numbers — they are what the tool would
// derive from these per-dimension scores.
function finalize(card) {
  const overallScore = computeScore(card.dimensions);
  return { ...card, overallScore, verdict: toVerdict(overallScore) };
}

const ships = {
  input: {
    claim:
      "We are open-sourcing a 13B code model that matches GPT-4o on HumanEval and SWE-bench Verified.",
    context:
      "Release post links a public GitHub repo with weights, an eval harness, a dockerized reproduction script, and a model card listing latency, cost, and known failure modes. Third parties have already reproduced the HumanEval number within 0.4 points.",
    sourceUrl: "https://example.com/oss-code-model",
  },
  verdict: "SHIPS",
  overallScore: 82.5,
  dimensions: [
    {
      dimension: "reproducibility",
      score: 92,
      inconclusive: false,
      confidence: 0.85,
      reasoning:
        "Weights, eval harness, and a dockerized script are public, and an independent group reproduced HumanEval within 0.4 points. Reproduction is demonstrated, not merely promised.",
    },
    {
      dimension: "evidence_quality",
      score: 88,
      inconclusive: false,
      confidence: 0.8,
      reasoning:
        "Numbers are reported on named public benchmarks (HumanEval, SWE-bench Verified) with the harness attached, rather than screenshots or hand-picked examples.",
    },
    {
      dimension: "scope_honesty",
      score: 78,
      inconclusive: false,
      confidence: 0.7,
      reasoning:
        "Claim is scoped to code generation and two benchmarks; the post does not overreach into general reasoning. SWE-bench Verified is narrower than real-world repos, which slightly tempers the claim.",
    },
    {
      dimension: "production_readiness",
      score: 74,
      inconclusive: false,
      confidence: 0.65,
      reasoning:
        "Model card lists latency and cost and provides a serving path, but governance and reliability at scale are asserted rather than independently shown.",
    },
    {
      dimension: "novelty",
      score: 70,
      inconclusive: false,
      confidence: 0.6,
      reasoning:
        "Matching a frontier model at 13B open weights is a meaningful efficiency result, though the architecture itself is a refinement of known techniques rather than a new capability.",
    },
    {
      dimension: "hidden_caveats",
      score: 80,
      inconclusive: false,
      confidence: 0.7,
      reasoning:
        "The model card discloses known failure modes, license constraints, and the gap on multi-file edits. Few material caveats appear to be hidden.",
    },
  ],
  summary:
    "A vendor open-sources a 13B code model and claims parity with GPT-4o on HumanEval and SWE-bench Verified, backing the claim with public weights, an eval harness, a reproduction script, and an independent reproduction of the headline number.",
  assertions: [
    {
      id: "a1",
      text: "The 13B model matches GPT-4o on HumanEval.",
      testable: true,
      relatesTo: ["evidence_quality", "reproducibility"],
    },
    {
      id: "a2",
      text: "The 13B model matches GPT-4o on SWE-bench Verified.",
      testable: true,
      relatesTo: ["evidence_quality", "scope_honesty"],
    },
    {
      id: "a3",
      text: "The weights and eval harness are open-sourced.",
      testable: true,
      relatesTo: ["reproducibility"],
    },
  ],
  strongestSteelman:
    "The release attaches public weights, a runnable eval harness, and a dockerized reproduction script, and an independent group has already reproduced the HumanEval number within half a point. When a claim ships with the means to falsify it and survives an outside reproduction, it is credible by default.",
  strongestDebunk:
    "Production-readiness (severity 35/100): reliability, governance, and cost at production scale are asserted in the model card but not independently demonstrated, so deployability beyond the benchmark setting remains partly unproven.",
  model: "claude-sonnet-4-6",
  generatedAt: "2026-05-31T18:42:00.000Z",
};

const theater = {
  input: {
    claim:
      "Our autonomous agent resolves 90% of real customer support tickets with no human in the loop.",
    context:
      "Announcement is a launch video and a landing page. No benchmark, no dataset, no methodology for the 90% figure, no latency or cost numbers, and no description of which ticket types are covered. 'Autonomous' is the headline; the demo shows three scripted tickets.",
    sourceUrl: "https://example.com/agent-launch",
  },
  verdict: "THEATER",
  overallScore: 24.6,
  dimensions: [
    {
      dimension: "reproducibility",
      score: 8,
      inconclusive: false,
      confidence: 0.8,
      reasoning:
        "There is no dataset, no methodology, and no way for an outside party to reproduce the 90% figure. The only artifacts are a video and a landing page.",
    },
    {
      dimension: "evidence_quality",
      score: 12,
      inconclusive: false,
      confidence: 0.8,
      reasoning:
        "The headline number has no measurement behind it — no ticket corpus, no resolution definition, no baseline. Three scripted demo tickets are not evidence of a 90% rate.",
    },
    {
      dimension: "scope_honesty",
      score: 20,
      inconclusive: false,
      confidence: 0.7,
      reasoning:
        "'Real customer support tickets' implies broad coverage, but nothing states which categories, languages, or escalation paths are included. Narrow scripted scenarios are presented as a general capability.",
    },
    {
      dimension: "production_readiness",
      score: 28,
      inconclusive: false,
      confidence: 0.6,
      reasoning:
        "No latency, cost, reliability, or governance detail is given, and 'no human in the loop' is stated without any description of failure handling or escalation.",
    },
    {
      dimension: "novelty",
      score: null,
      inconclusive: true,
      confidence: 0,
      reasoning:
        "Nothing in the announcement describes the underlying approach, so there is no basis to judge whether the capability is genuinely new or a wrapper. Marked inconclusive rather than guessed.",
    },
    {
      dimension: "hidden_caveats",
      score: 18,
      inconclusive: false,
      confidence: 0.7,
      reasoning:
        "The most consequential facts are unsaid: how 'resolution' is defined, what the human-handoff rate actually is, and what the failure modes cost. The framing hides exactly what a buyer needs.",
    },
  ],
  summary:
    "A vendor claims a fully autonomous agent resolves 90% of real support tickets with no human in the loop, supported only by a launch video and landing page with no dataset, methodology, or operational numbers.",
  assertions: [
    {
      id: "a1",
      text: "The agent resolves 90% of real customer support tickets.",
      testable: true,
      relatesTo: ["evidence_quality", "reproducibility", "scope_honesty"],
    },
    {
      id: "a2",
      text: "Resolution happens with no human in the loop.",
      testable: true,
      relatesTo: ["production_readiness", "hidden_caveats"],
    },
  ],
  strongestSteelman:
    "If the 90% figure were drawn from a representative production ticket stream, a fully autonomous agent at that resolution rate would be a substantial result. The team may have real internal data they simply chose not to publish in the launch material.",
  strongestDebunk:
    "Reproducibility (severity 92/100): there is no dataset, no resolution definition, and no methodology behind the 90% figure — the claim ships with nothing an outside party could use to falsify it, which is the signature of a demo dressed as a result.",
  model: "claude-sonnet-4-6",
  generatedAt: "2026-05-31T18:55:00.000Z",
};

writeFileSync(
  new URL("./ships-example.md", import.meta.url),
  renderMarkdown(finalize(ships)),
);
writeFileSync(
  new URL("./theater-example.md", import.meta.url),
  renderMarkdown(finalize(theater)),
);
console.log("wrote ships-example.md and theater-example.md");
