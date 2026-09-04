---
status: accepted
---

# Defer Kafka Case evaluation until the CaseSpec is accepted

The first Kafka Production Case combines an engineering design artifact, implementation behaviour
and operational evidence in C#/.NET or Python. Platform will not choose its submission protocol,
source handoff, evaluator runtime or terminal result language until an accepted CaseSpec states
which facts must be observed and which decisions require qualitative explanation.

This supersedes ADR 0014 as current Workshop guidance. The pinned native Go CLI, device protocol,
versioned schemas and local Compose runner remain implemented Partner Webhooks foundations. They
are not removed, but neither their existence nor their successful earlier smokes makes them the
default evaluator for Kafka. Research #278 must explicitly accept, narrow or retire each reused
piece.

The evaluation decision follows this order:

1. #277 fixes the business invariants, design artifact, common behavioural contract and required
   evidence of the Kafka Case.
2. #278 compares bounded local and GitHub-based handoffs and any materially different candidate
   justified by that contract.
3. The owner accepts one trust boundary and honest result language.
4. #282 implements the C#/.NET and Python variants against that exact decision.

Any accepted design must keep qualitative architecture reasoning distinct from automatically
observed behaviour, must not present a learner-controlled local run as independent verification,
and must support both language variants without changing the Case meaning. Running participant
code inside Platform remains out of scope unless a later ADR supplies a concrete security,
operations and cost justification.

Deferral is itself the current decision, not permission to create a generic evaluation framework.
The trigger for a replacement ADR is an accepted #278 boundary with a real Kafka CaseSpec and
representative evidence from both stacks.
