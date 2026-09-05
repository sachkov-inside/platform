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
existing release record and its manifest cannot be replaced through the normal release interface.

The ordinal is a human-facing release identity, not a dependency version or runtime image selector.
Backend and web images carry the ordinal tag for discovery, while every runtime consumer must use
the exact public GHCR digest recorded in the release manifest. No `latest` or other moving tag is
part of the contract. Because GitHub creates new container packages as private, the owner must
bootstrap both package names and set their visibility to public before the first ordinal release;
the workflow then proves anonymous access to every candidate digest before finalization.

One captured SHA passes the reusable application CI before either image is built. The image build job
publishes both production images, records their exact digests and proves anonymous digest access
before finalization. SBOM generation, provenance attestations and vulnerability scanning are not
part of this initial release contract; they can be introduced later when the product has an
operational requirement for them.

One Zod contract owns the closed manifest shape and external release inputs. The manifest binds only
version and source commit to the backend and web `name@sha256:...` references. The source commit
already identifies migrations and checked-in configuration, so their hashes are not duplicated.
The initial immutable GitHub Release stored only this manifest. ADR 0015 later added the
manifest-bound runtime bundle and deployment evidence without changing the ordinal/image identity
chosen here.

This decision separates release creation from deployment. Publishing `vN` does not connect to the
production host and does not authorize a rollout. The deployment pipeline defined by ADR 0015
selects that manifest and runs its exact digests; it does not rebuild source or infer release
identity from a moving branch or tag.
