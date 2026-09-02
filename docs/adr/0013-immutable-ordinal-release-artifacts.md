---
status: accepted
---

# Publish immutable ordinal release artifacts from exact main

Platform releases use one monotonically increasing ordinal namespace: `v1`, `v2`, and so on. A
release dispatch captures one full commit SHA and succeeds only when that SHA is still current
`main`, the requested version is exactly the next ordinal, and all retained ordinal tags form a
contiguous history. The workflow serializes releases globally and rechecks those invariants before
creating the GitHub Release. Repository immutable releases must be enabled, so an existing release
record and its attached evidence cannot be replaced through the normal release interface.

The ordinal is a human-facing release identity, not a dependency version or runtime image selector.
Backend and web images carry the ordinal tag for discovery, while every runtime consumer must use
the exact public GHCR digest recorded in the release manifest. No `latest` or other moving tag is
part of the contract.

One captured SHA passes the reusable application CI before either image is built. Each image then
receives an SPDX SBOM, build provenance and SBOM attestations. The workflow verifies the
attestations and the exact attested SBOM, applies a fail-closed high/critical vulnerability policy,
and proves anonymous digest access. A vulnerability exception is allowed only with an owner-supplied
reason recorded with the actor and workflow run. Missing, inconsistent or tampered evidence cannot
enter the manifest.

The closed manifest schema binds version and source to image digests, migration/configuration tree
identities, evidence hashes, attestation records and any vulnerability waiver. The GitHub Release
stores the manifest together with both images' evidence assets. The schema and executable policy
are versioned with the source repository so future consumers can interpret the record without
trusting workflow logs.

This decision separates release creation from deployment. Publishing `vN` does not connect to the
production host and does not authorize a rollout. A later deployment pipeline will select a
manifest and run its exact digests; it must not rebuild source or infer release identity from a
moving branch or tag.
