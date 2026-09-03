---
status: accepted
---

# Publish immutable ordinal release artifacts from exact main

Platform releases use one monotonically increasing ordinal namespace: `v1`, `v2`, and so on. A
release dispatch captures one full commit SHA and succeeds only when that SHA is still current
`main`, the requested version is exactly the next ordinal, and all retained ordinal tags map
one-to-one to published immutable Releases with the complete release asset set. Their versions
must form a contiguous history. The workflow serializes releases globally and rechecks those
invariants before creating the GitHub Release. Repository immutable releases must be enabled, so an
existing release record and its attached evidence cannot be replaced through the normal release
interface.

The ordinal is a human-facing release identity, not a dependency version or runtime image selector.
Backend and web images carry the ordinal tag for discovery, while every runtime consumer must use
the exact public GHCR digest recorded in the release manifest. No `latest` or other moving tag is
part of the contract. Because GitHub creates new container packages as private, the owner must
bootstrap both package names and set their visibility to public before the first ordinal release;
the workflow then proves anonymous access to every candidate digest before finalization.

One captured SHA passes the reusable application CI before either image is built. Each image then
receives signed GitHub build provenance and SPDX SBOM attestations. The same generated SBOM is
scanned by the fail-closed high/critical vulnerability policy before it is attested. Both the image
job and finalization verify the standard attestations against the exact image digest, source commit,
`main` ref and trusted workflow with `gh attestation verify`; the repository does not define a
second evidence format. A vulnerability exception is allowed only with an owner-supplied reason
recorded with the actor and workflow run. Missing or invalid attestations stop the release, and the
workflow proves anonymous digest access before finalization.

One Zod contract owns the closed manifest shape and external release inputs; the published JSON
Schema is generated from it. The manifest is deliberately small: it binds version and source commit
to the backend and web `name@sha256:...` references and records an applied vulnerability waiver.
The source commit already identifies migrations and checked-in configuration, so their hashes are
not duplicated. SBOM and provenance remain standard attestations attached to each OCI image. The
immutable GitHub Release stores the manifest and both vulnerability reports; future deployment
consumes the manifest without parsing workflow-internal evidence.

This decision separates release creation from deployment. Publishing `vN` does not connect to the
production host and does not authorize a rollout. A later deployment pipeline will select a
manifest and run its exact digests; it must not rebuild source or infer release identity from a
moving branch or tag.
