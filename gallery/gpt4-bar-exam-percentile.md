# Ship or Theater — Scorecard

**Verdict:** MIXED — Real signal, but meaningful gaps or unproven claims remain.

**Reality score:** 46.1 / 100

**Claim:** it passes a simulated bar exam with a score around the top 10% of test takers

**Context:** OpenAI made this comparison when releasing GPT-4 text capabilities through ChatGPT and an API waitlist. [1] Katz and colleagues reported a simulated Uniform Bar Examination score of approximately 297, above the passing thresholds they considered; their paper acknowledges assistance from OpenAI. [2] Their published discussion places the score between approximately the 68th and 90th percentiles depending on the jurisdiction and exam administration used for comparison. [2] Eric Martínez's re-evaluation replicated the multiple-choice score but challenged the essay grading and comparison population, estimating approximately the 62nd percentile against first-time test takers. [3]

**Source:** https://openai.com/index/gpt-4-research/

## Summary

The claim, made by OpenAI at the release of GPT-4's text capabilities, is that the model passes a simulated bar exam with a score in about the top 10% of human test takers. Context indicates this rests on a simulated Uniform Bar Examination score of about 297 reported by Katz et al., a paper with OpenAI assistance, which placed the score between roughly the 68th and 90th percentiles depending on the comparison. A later re-evaluation by Martínez replicated the multiple-choice result but disputed the essay grading and the comparison population, estimating about the 62nd percentile against first-time test takers. The claim therefore bundles a passing-score assertion, a percentile-rank assertion that depends on population choice, and an implicit generalization to legal competence. It also carries questions about vendor involvement and reproducibility.

## Dimensions

| # | Dimension | Weight | Score | Confidence |
|---|-----------|--------|-------|------------|
| 1 | Reproducibility | 0.2 | 50 | 60% |
| 2 | Evidence quality | 0.2 | 52 | 60% |
| 3 | Scope honesty | 0.2 | 38 | 65% |
| 4 | Production-readiness | 0.15 | 35 | 50% |
| 5 | Novelty | 0.1 | 68 | 60% |
| 6 | Hidden caveats | 0.15 | 40 | 60% |

_6 of 6 dimensions scored; 0 inconclusive (excluded from the weighted mean)._

### Per-dimension reasoning

- **Reproducibility** (50/100): The multiple-choice result was independently replicated by Martínez, which is real reproducibility evidence for the core exam ability. But the headline percentile depends on essay grading by the study authors (not official bar graders) and on the comparison population. The independent re-evaluation lands at about the 62nd percentile, well short of the 90th. Vendor involvement, a possibly pre-release model, no published exact prompts, and unruled-out contamination limit third-party reproduction of the 'top 10%' figure. Partial reproducibility of the pass, weak reproducibility of the percentile.
- **Evidence quality** (52/100): There is quantitative data: a published study with a ~297 simulated UBE score, a stated 68th–90th percentile range, and an independent replication of the MCQ portion. That is well above screenshots and vibes. But the cited headline is the top of the range, the supporting paper acknowledges OpenAI help, essay grading was non-official and contested, and the population choice moves the percentile a lot. Run variance and contamination are undocumented. The evidence supports 'passes and lands above the median' much better than 'top 10%'.
- **Scope honesty** (38/100): The claim picks the most flattering end of a published range and drops the dependence on jurisdiction, administration and comparison population. The one independent estimate against first-time takers is ~62nd percentile, so the framing overstates standing. A simulated exam is also a narrow proxy that invites an implied leap to general legal competence, with no evidence on real legal tasks. The underlying capability is real, which keeps this above theater, but the headline is selectively framed.
- **Production-readiness** (35/100): The claim is a capability benchmark, not a deployment claim, so low production evidence is partly expected. Even so, there is no data on cost, latency, run-to-run variance, failure modes such as hallucinated citations, or governance for legal use. Nothing ties the tested configuration to the deployed ChatGPT/API model. Public availability shows access, not readiness. A deployment decision could not responsibly rest on the 'top 10%' headline.
- **Novelty** (68/100): GPT-4 clearly outperformed GPT-3.5 on this task, and the MCQ result replicated. This is a real capability improvement, not a wrapper or rebrand. The size is inflated by the percentile framing, and the likely cause is scaling gains rather than a new technique. Contamination was not ruled out, and no architecture or training detail was disclosed, so attributing the advance is hard. Moderate-to-good credit for a genuine but overstated step up.
- **Hidden caveats** (40/100): The headline omits the 68th–90th range, the population effect that yields ~62nd against first-time takers, author-graded essays, OpenAI's role in the study, possible contamination, run variance and the tested-versus-deployed model question. It also says nothing about failure modes such as hallucinated citations. Some of these appear in the published paper, and there is no fabrication, since the underlying score is partly replicated. Still, the omissions are material and consistently make the claim look better.

## Strongest steelman (best case FOR)

This is one of the better-documented capability claims in the GPT-4 launch. The headline is backed by a named, peer-reviewed-style external study (Katz et al.) that reports a concrete simulated UBE score of about 297, above the passing cutoffs they considered. The multiple-choice portion is objective and was independently replicated by Martínez, a skeptic who set out to challenge the result. Even that critical re-evaluation puts GPT-4 at about the 62nd percentile against first-time takers, which is still a passing score and a clear step up from GPT-3.5's reported bottom-10% result. The 'top 10%' figure is the optimistic end of a published 68th–90th percentile range. So the real finding is 'passes, and lands well above the median'. The model was also released to the public through ChatGPT and an API waitlist, so users could try the capability themselves.

## Strongest debunk (best case AGAINST)

Scope honesty (severity 68/100): Headline 'top 10%' is the most favorable end of a 68th–90th percentile range; the claim omits the range and the dependence on jurisdiction and administration.

## Extracted assertions

- [a1] GPT-4 passes a simulated bar exam (the Uniform Bar Examination), i.e., achieves a score above the passing thresholds. _(testable)_
- [a2] GPT-4's simulated bar exam score falls around the top 10% of test takers (roughly the 90th percentile). _(testable)_
- [a3] The simulated exam result (approx. UBE score of 297) is a valid, representative measure of the model's legal competence, i.e., the result generalizes beyond the specific exam setup. _(testable)_
- [a4] The percentile comparison is made against an appropriate population of human test takers (e.g., all takers vs. first-time takers, specific jurisdiction and administration). _(testable)_
- [a5] The essay (written) portions were graded in a way that fairly reflects human bar-exam grading standards. _(testable)_
- [a6] The result is independently reproducible: third parties can obtain the same multiple-choice and overall scores with the model. _(testable)_
- [a7] The capability represents a genuine advance over prior models (GPT-3.5 reportedly scored far lower, around the bottom 10%). _(testable)_
- [a8] The evaluation was conducted without undue influence or conflict of interest (the supporting study acknowledges OpenAI assistance, and the claim originates from the model vendor). _(not directly testable)_
- [a9] The model's performance is available to users through ChatGPT and an API waitlist, implying the tested capability is accessible in a deployed form, though it is unclear whether the tested configuration matches deployed behavior. _(testable)_

---

_Generated by ship-or-theater using sonnet (via Claude CLI / subscription) at 2026-11-07T23:37:41.540Z._
