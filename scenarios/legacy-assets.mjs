// @ts-check
/** The existing overview's two assets; upload adapters replace the legacy placeholder IDs. */
export const legacyAssetsScenario = /** @type {const} */ ({
  slug: "kak-ustroen-inside-platform",
  assets: [
    {
      key: "reader-path",
      nodeId: "72000000-0000-4000-8000-000000000025",
      legacyAssetId: "72000000-0000-4000-8000-000000000030",
      kind: "image",
      filename: "synthetic-reader-path.svg",
      contentType: "image/svg+xml",
      alt: "Путь Material от PostgreSQL до Reader",
      caption: "Один vertical production path",
      text: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="160" viewBox="0 0 640 160"><rect width="640" height="160" fill="#f4f5ed"/><rect x="20" y="40" width="230" height="80" rx="12" fill="#dce8d5"/><path d="M270 80H370m-15-12 15 12-15 12" stroke="#263429" stroke-width="4" fill="none"/><rect x="390" y="40" width="230" height="80" rx="12" fill="#dce8d5"/><g font-family="sans-serif" font-size="24" text-anchor="middle" fill="#263429"><text x="135" y="89">PostgreSQL</text><text x="505" y="89">Reader</text></g></svg>',
    },
    {
      key: "reader-checklist",
      nodeId: "72000000-0000-4000-8000-000000000026",
      legacyAssetId: "72000000-0000-4000-8000-000000000031",
      kind: "file",
      filename: "synthetic-reader-checklist.txt",
      contentType: "text/plain",
      label: "Reader verification checklist",
      text: "Проверка Reader: открыть материал, прочитать текст, скачать файл.\n",
    },
  ],
});
