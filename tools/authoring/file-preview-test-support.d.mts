/** Kinescope ID of the synthetic lesson's video. */
export declare const previewVideoId: string;

export type PreviewRow = { readonly sourceId: string } & Readonly<
  Record<string, unknown>
>;
export type PreviewManifest = {
  readonly materials: readonly PreviewRow[];
} & Readonly<Record<string, unknown>>;

/**
 * Writes the synthetic course package into `directory` and returns its package.json path. `change`
 * edits the manifest first, as an author's edit and a new export would.
 */
export declare function writePreviewPackage(
  directory: string,
  change?: (manifest: PreviewManifest) => unknown,
): Promise<string>;
