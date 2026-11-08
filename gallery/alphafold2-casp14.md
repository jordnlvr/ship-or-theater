# Ship or Theater — Scorecard

**Verdict:** MIXED — Real signal, but meaningful gaps or unproven claims remain.

**Reality score:** 65.8 / 100

**Claim:** our latest AlphaFold system achieves a median score of 92.4 GDT overall across all targets.

**Context:** DeepMind reported this result for AlphaFold 2 in CASP14, an assessment using protein structures withheld from participants before prediction. [1] DeepMind subsequently made AlphaFold 2 inference code and model parameters available in its public repository. [2] The independent ColabFold team reported matching AlphaFold 2 prediction quality on CASP14 targets using AlphaFold 2 with a different sequence-search pipeline. [3] The AlphaFold repository cautions that some CASP14 targets involved manual interventions and that reproducing the competition results requires the original database versions. [2]

**Source:** https://deepmind.google/blog/alphafold-a-solution-to-a-50-year-old-grand-challenge-in-biology/

## Summary

The claim states that DeepMind's latest AlphaFold system (AlphaFold 2 at CASP14) achieved a median GDT score of 92.4 across all targets in a blind structure-prediction assessment where experimentally determined structures were withheld from participants. The implied framing is that this near-experimental accuracy represents a breakthrough on the protein folding problem. The surrounding context adds that the code and weights were later publicly released, that ColabFold reportedly matched quality on CASP14 targets with a different sequence-search pipeline, and that the AlphaFold repository cautions that some CASP14 targets involved manual interventions and that reproducing competition results requires the original database versions.

## Dimensions

| # | Dimension | Weight | Score | Confidence |
|---|-----------|--------|-------|------------|
| 1 | Reproducibility | 0.2 | 68 | 70% |
| 2 | Evidence quality | 0.2 | 78 | 75% |
| 3 | Scope honesty | 0.2 | 55 | 65% |
| 4 | Production-readiness | 0.15 | 62 | 55% |
| 5 | Novelty | 0.1 | 88 | 80% |
| 6 | Hidden caveats | 0.15 | 50 | 65% |

_6 of 6 dimensions scored; 0 inconclusive (excluded from the weighted mean)._

### Per-dimension reasoning

- **Reproducibility** (68/100): CASP14 was a blind, prospective test with published targets and independent scoring. DeepMind released code and parameters, and ColabFold independently reported matching quality. Against that, the repository says some targets involved manual intervention and that exact competition results need the original database versions. So the 92.4 figure cannot be reproduced bit for bit, and the blog gives no methodology. The capability is reproducible in spirit, but the exact number is only partly so.
- **Evidence quality** (78/100): CASP14 is a community-run blind benchmark with independent assessors, which makes it much stronger evidence than a self-chosen demo. The weaknesses are that the cited source is a vendor blog, the median hides the distribution, 'all targets' is ambiguous (targets versus domains), and no confidence intervals are given. ColabFold's corroboration is real but is not an exact reproduction. The core number is well supported, and the surrounding framing is thinner.
- **Scope honesty** (55/100): The literal claim is tied to a named benchmark and metric, which is honest. But 'overall across all targets' sits in a blog titled 'a solution to a 50-year-old grand challenge', which invites a broader reading. CASP14 is a small set of mostly single-chain domains. GDT_TS says nothing about side chains, complexes, disorder or dynamics. The median hides tail failures, and the manual interventions on some targets are not mentioned in the claim. The number is honest and the surrounding generalization is overstated.
- **Production-readiness** (62/100): The claim is only an accuracy benchmark and gives no latency, cost, reliability or governance data. Still, the code and weights were released and are widely used, and ColabFold gives a faster search pipeline. That shows real deployability for the technology. The competition result itself involved some manual steps and specific database versions, so it is not evidence of a hands-off production pipeline. Compute and MSA search costs go unstated.
- **Novelty** (88/100): AlphaFold 2's CASP14 result was a widely recognized step change over prior methods, including AlphaFold 1, with a large gap to the next-best entrant. It is not a wrapper or rebrand. ColabFold reuses the model with a different search front end, so it does not undercut the novelty. The claim text does not itself say what is new, and 'latest' is now stale, which takes off a little.
- **Hidden caveats** (50/100): The claim leaves out several things: manual interventions on some targets, dependence on the original database versions, compute cost, and the median's hiding of low-scoring targets. It also omits that CASP14 targets are mostly single-chain domains with deep MSAs, and that 'latest' has lapsed. Some of these are disclosed in the AlphaFold repository, which helps. The headline number is real, but a reader of the claim alone would miss material caveats.

## Strongest steelman (best case FOR)

The headline number is the best-documented part of the claim. DeepMind reported a median GDT_TS of 92.4 for AlphaFold 2 at CASP14, which is a blind, prospective assessment. The target structures were withheld from all participants until after predictions were submitted, and CASP's independent assessors scored them. That structure is much harder to game than a self-chosen benchmark, and it supports the 'across all targets' framing, since CASP scores the whole target set rather than a hand-picked subset. Post-competition developments also strengthen the case. DeepMind released AlphaFold 2 inference code and model parameters publicly, so independent parties can run the same model. The independent ColabFold team reported matching AlphaFold 2 prediction quality on CASP14 targets with a different sequence-search pipeline. That is evidence the capability is a property of the model and not of one tightly controlled setup. It was also a real step change. The context describes it as a blind-test result with independent follow-up, not a demo. The best case holds for the narrow claim: AlphaFold 2 scored a median GDT_TS of 92.4 on CASP14. It is weaker for the claims that this is the 'latest' system, that it was fully automated, that the exact result is reproducible, and that it generalizes to protein folding broadly.

## Strongest debunk (best case AGAINST)

Hidden caveats (severity 58/100): The claim says 'across all targets' but omits that the CASP14 assessment and the AlphaFold repo itself note that some targets involved manual interventions, so the result was not purely automated end to end (contradicts a4).

## Extracted assertions

- [a1] AlphaFold 2 (the 'latest' system at the time of CASP14) achieved a median GDT_TS of 92.4 across all CASP14 targets. _(testable)_
- [a2] The 92.4 median GDT score was measured on CASP14, an assessment using protein structures withheld from participants before prediction (i.e., a blind, prospective test). _(testable)_
- [a3] The 92.4 median is computed 'overall across all targets', implying it covers every CASP14 target without exclusion or cherry-picking. _(testable)_
- [a4] The result was produced by the automated AlphaFold 2 system without manual intervention on any target. _(testable)_
- [a5] The AlphaFold 2 system described is the 'latest' AlphaFold system (a currency claim), as opposed to a superseded version. _(testable)_
- [a6] The CASP14 result can be reproduced by independent parties using the publicly released AlphaFold 2 code and parameters. _(testable)_
- [a7] Equivalent prediction quality on CASP14 targets is achievable with alternative pipelines such as ColabFold, which uses a different sequence-search method. _(testable)_
- [a8] A median GDT of 92.4 implies the system generalizes to protein structure prediction broadly (beyond CASP14 targets), i.e., a solution to the protein folding problem. _(testable)_

---

_Generated by ship-or-theater using sonnet (via Claude CLI / subscription) at 2026-11-07T23:34:54.744Z._
