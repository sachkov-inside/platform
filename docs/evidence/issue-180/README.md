# Issue #180 UI evidence

Captured from the production Editor and Reader routes during the real PostgreSQL/MinIO full-stack
smoke. Both Playwright projects passed the WCAG A/AA serious/critical Axe check before capture.

| Evidence | Desktop | Mobile |
|---|---|---|
| chooser + paste + drop ready states | `editor-ready-desktop.png` | `editor-ready-mobile.png` |
| published inline image and file cards | `reader-inline-assets-desktop.png` | `reader-inline-assets-mobile.png` |

Reproduce with:

```bash
CAPTURE_EVIDENCE=1 OBJECT_STORAGE_ENDPOINT=http://127.0.0.1:19000 pnpm smoke:fullstack
```

Automated evidence is complete. Owner visual acceptance of the production upload queue remains in
[#190](https://github.com/sachkov-inside/platform/issues/190); it is distinct from merge approval.
