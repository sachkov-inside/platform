export interface StoredSourceArchive {
  readonly key: string;
  readonly digest: string;
  readonly byteSize: number;
  readonly retentionTime: string;
}

export type StoreSourceArchiveResult =
  | Readonly<{ ok: true; value: StoredSourceArchive }>
  | Readonly<{
      ok: false;
      error: { readonly code: "dependency_unavailable" | "invalid_archive" };
    }>;

export interface SourceArchives {
  store(input: {
    readonly body: Uint8Array;
    readonly contentType: string;
    readonly retentionTime: string;
  }): Promise<StoreSourceArchiveResult>;
}
