# Isolated quiz acceptance

A quiz acceptance run against the editor runtime, without Compose.

## Isolated quiz acceptance (#1283)

After starting the owned `pnpm editor:local` runtime, run:

```bash
CAPTURE_EVIDENCE=1 pnpm --filter @inside/web test:fullstack --config playwright.quiz.config.ts
```

The configuration addresses only the editor gateway at `127.0.0.1:4396`.
It never starts or resets Compose. The live test imports synthetic Content `readerBlocks`, exercises
Reader answers/keyboard/anchors, checks axe and editor roundtrip, and keeps the synthetic materials
for owner review. It does not prove real Logto sign-in or purchases. Screenshots go to
`docs/evidence/issue-1283`; the console records Reader/editor routes. Resolve internal web port
conflicts through the editor runtime configuration before launch; leave another session's stand alone.
