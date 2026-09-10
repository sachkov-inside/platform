/** Covers the 1 MiB Material document contract plus form and metadata overhead. */
export const MAX_BROWSER_MUTATION_BYTES = 2 * 1_024 * 1_024;

/** Product capability limit for one source image before normalization. */
export const MAX_PROFILE_AVATAR_FILE_BYTES = 10 * 1_024 * 1_024;

/** Leaves a bounded envelope for multipart fields around the 10 MiB source image. */
export const MAX_PROFILE_AVATAR_MUTATION_BYTES =
  MAX_PROFILE_AVATAR_FILE_BYTES + 64 * 1_024;

/** Product capability limit shared with the backend Content Cover processor. */
export const MAX_CONTENT_COVER_FILE_BYTES = 10 * 1_024 * 1_024;

/** Leaves a bounded envelope for multipart Content Cover metadata. */
export const MAX_CONTENT_COVER_MUTATION_BYTES =
  MAX_CONTENT_COVER_FILE_BYTES + 64 * 1_024;

/** Product capability limit shared with the backend Guide Artifact processor. */
export const MAX_GUIDE_ARTIFACT_FILE_BYTES = 25 * 1_024 * 1_024;

/** Leaves a bounded envelope for multipart Guide Artifact metadata. */
export const MAX_GUIDE_ARTIFACT_MUTATION_BYTES =
  MAX_GUIDE_ARTIFACT_FILE_BYTES + 64 * 1_024;
