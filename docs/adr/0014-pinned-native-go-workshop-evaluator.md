---
status: accepted
---

# Run the Workshop evaluator as a pinned native Go CLI

Platform keeps its TypeScript/Next/Nest control plane, while Workshop evaluation runs in a
separately built, Platform-owned native Go CLI on the learner-controlled machine. The evaluator is
not a network service, and Platform API or worker processes never execute participant code. Go and
TypeScript share versioned JSON Schemas and conformance fixtures rather than runtime packages; the
CLI communicates with Platform only through the versioned device-authorization and report
protocols and never receives a reusable Platform or GitHub credential.

Go was selected so the evaluator can ship as a pinned artifact without a learner-managed language
runtime while owning cross-platform process, cancellation and Docker Compose behaviour directly.
The first supported matrix is `darwin/arm64`, `linux/amd64` and `windows/amd64`; real Compose smokes
on all three targets established this boundary before acceptance. A TypeScript CLI would couple
evaluation to a compatible Node.js installation, while running evaluation as a Platform service
would violate the local-execution boundary.

Native bundles use exact versions and checksums and never auto-update. A local evaluation report
remains untrusted evidence: Platform validates and binds it to exact source before deriving an
AttemptResult, so the CLI cannot assign `Passed`. This decision is limited to the Workshop
evaluator and does not introduce Go as a Platform backend or service language.
