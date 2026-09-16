---
status: accepted
---

# Defer Kafka Case evaluation until the CaseSpec is accepted

On 2026-09-16 the owner removed Workshop and the Kafka Track from the plan and deleted their
issues. The deferral stands; resuming the direction starts with a new issue.

The first Kafka Production Case combines an engineering design artifact, implementation behaviour
and operational evidence in C#/.NET or Python. Platform will not choose its submission protocol,
source handoff, evaluator runtime or terminal result language until an accepted CaseSpec states
which facts must be observed and which decisions require qualitative explanation.

This supersedes ADR 0019 as current Workshop guidance. The pinned native Go CLI, device protocol,
versioned schemas and local Compose runner remain implemented Partner Webhooks foundations. They
are not removed, but neither their existence nor their successful earlier smokes makes them the
default evaluator for Kafka. Evaluation research must explicitly accept, narrow or retire each reused
piece.

The evaluation decision follows this order:

1. The CaseSpec fixes the business invariants, design artifact, common behavioural contract and required
   evidence of the Kafka Case.
2. Evaluation research compares bounded local and GitHub-based handoffs and any materially different candidate
   justified by that contract.
3. The owner accepts one trust boundary and honest result language.
4. The variants ticket implements the C#/.NET and Python variants against that exact decision.

Any accepted design must keep qualitative architecture reasoning distinct from automatically
observed behaviour, must not present a learner-controlled local run as independent verification,
and must support both language variants without changing the Case meaning. Running participant
code inside Platform remains out of scope unless a later ADR supplies a concrete security,
operations and cost justification.

Deferral is itself the current decision, not permission to create a generic evaluation framework.
The trigger for a replacement ADR is an accepted evaluation research boundary with a real Kafka CaseSpec and
representative evidence from both stacks.
