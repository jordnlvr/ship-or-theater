import type { LLM, LLMRequest } from "../src/llm.js";
import {
  type Extraction,
  type Judgement,
  type SkepticFinding,
  type Steelman,
} from "../src/types.js";

/**
 * A deterministic fake `llm` for tests. It routes on the forced tool name and
 * returns canned, schema-valid objects (or throws, to exercise failure paths).
 * No network, no API key.
 */

export interface FakeLLMConfig {
  extraction?: Extraction;
  /** Per-dimension override; key = dimension, value = finding or "throw". */
  skeptic?: (dimension: string) => SkepticFinding | "throw";
  steelman?: Steelman;
  judge?: (findings: SkepticFinding[]) => Judgement;
}

const DEFAULT_EXTRACTION: Extraction = {
  summary: "A vendor claims their model beats GPT-4 on internal benchmarks.",
  assertions: [
    {
      id: "a1",
      text: "The model beats GPT-4 on internal benchmarks.",
      testable: true,
      relatesTo: ["evidence_quality", "reproducibility"],
    },
  ],
};

const DEFAULT_STEELMAN: Steelman = {
  strongestCase:
    "If the internal benchmarks are representative, this is a real gain.",
  supportingPoints: ["The team has shipped credible models before."],
};

function dimFromPrompt(prompt: string): string {
  // The skeptic prompt embeds "(<dimension_key>)" in the question line.
  const known = [
    "reproducibility",
    "evidence_quality",
    "scope_honesty",
    "production_readiness",
    "novelty",
    "hidden_caveats",
  ];
  for (const key of known) {
    if (prompt.includes(key)) return key;
  }
  return "reproducibility";
}

export function makeFakeLLM(config: FakeLLMConfig = {}): {
  llm: LLM;
  calls: Array<{ tool: string }>;
} {
  const calls: Array<{ tool: string }> = [];

  const llm: LLM = async <T>(request: LLMRequest<T>): Promise<T> => {
    calls.push({ tool: request.toolName });

    switch (request.toolName) {
      case "record_extraction": {
        const value = config.extraction ?? DEFAULT_EXTRACTION;
        return request.schema.parse(value);
      }
      case "record_skeptic_finding": {
        const dimension = dimFromPrompt(request.prompt);
        const produced = config.skeptic
          ? config.skeptic(dimension)
          : defaultSkepticFor(dimension);
        if (produced === "throw") {
          throw new Error(`fake skeptic failure for ${dimension}`);
        }
        return request.schema.parse(produced);
      }
      case "record_steelman": {
        const value = config.steelman ?? DEFAULT_STEELMAN;
        return request.schema.parse(value);
      }
      case "record_judgement": {
        const findings = lastFindings;
        const value = config.judge
          ? config.judge(findings)
          : defaultJudgeFor(findings);
        return request.schema.parse(value);
      }
      default:
        throw new Error(`fake llm: unexpected tool "${request.toolName}"`);
    }
  };

  // Track findings the judge should see. The judge prompt lists dimensions, so
  // we reconstruct them from the prompt rather than threading state through.
  let lastFindings: SkepticFinding[] = [];
  const wrapped: LLM = async <T>(request: LLMRequest<T>): Promise<T> => {
    if (request.toolName === "record_judgement") {
      lastFindings = parseFindingsFromJudgePrompt(request.prompt, config);
    }
    return llm(request);
  };

  return { llm: wrapped, calls };
}

function defaultSkepticFor(dimension: string): SkepticFinding {
  return {
    dimension: dimension as SkepticFinding["dimension"],
    concerns: [`No independent reproduction provided for ${dimension}.`],
    severity: 40,
    reasoning: `Standard skeptical pass over ${dimension}.`,
  };
}

function defaultJudgeFor(findings: SkepticFinding[]): Judgement {
  return {
    dimensions: findings.map((f) => ({
      dimension: f.dimension,
      // Map severity to a score (higher severity -> lower score).
      score: 100 - f.severity,
      inconclusive: false,
      confidence: 0.7,
      reasoning: `Judged ${f.dimension} from a severity of ${f.severity}.`,
    })),
  };
}

/**
 * Reconstruct which dimensions the judge is being asked about from the prompt's
 * "DIMENSIONS TO JUDGE:" line, then synthesize their findings so the default
 * judge can score them consistently with what the skeptics produced.
 */
function parseFindingsFromJudgePrompt(
  prompt: string,
  config: FakeLLMConfig,
): SkepticFinding[] {
  const match = prompt.match(/DIMENSIONS TO JUDGE: (.+)/);
  if (!match || !match[1]) return [];
  const keys = match[1]
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  return keys.map((key) => {
    const produced = config.skeptic
      ? config.skeptic(key)
      : defaultSkepticFor(key);
    if (produced === "throw") {
      // Should not happen — a thrown skeptic never reaches the judge — but keep
      // it total by falling back to a default.
      return defaultSkepticFor(key);
    }
    return produced;
  });
}
