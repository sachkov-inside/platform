FROM ghcr.io/logto-io/logto:1.44.0@sha256:847cdd2759ad60f61b9733af0ea352183c805681dff5c9f8140a80f52d8e1340

LABEL org.opencontainers.image.source="https://github.com/sachkov-inside/platform"
LABEL org.opencontainers.image.version="1.44.0-inside.7"
LABEL inside.logto.upstream-revision="79e9e3b0d9f505260d09c80d8a015e56fbc0ec01"

COPY fork/packages/experience/src/Layout/AppLayout/index.tsx packages/experience/src/Layout/AppLayout/index.tsx
COPY fork/packages/experience/src/Layout/AppLayout/index.module.scss packages/experience/src/Layout/AppLayout/index.module.scss
COPY fork/packages/experience/src/containers/VerificationCode/use-sign-in-flow-code-verification.ts packages/experience/src/containers/VerificationCode/use-sign-in-flow-code-verification.ts
COPY fork/packages/experience/src/utils/sign-in-experience.ts packages/experience/src/utils/sign-in-experience.ts
COPY patches/issue-116-logto-proof.patch /tmp/issue-116-logto-proof.patch
COPY patches/issue-299-unified-sign-in.patch /tmp/issue-299-unified-sign-in.patch
COPY patches/issue-938-offline-access-consent.patch /tmp/issue-938-offline-access-consent.patch

RUN apk add --no-cache --virtual .inside-patch-tools patch \
  && patch --fuzz=0 -p1 < /tmp/issue-116-logto-proof.patch \
  && patch --fuzz=0 -p1 < /tmp/issue-299-unified-sign-in.patch \
  && patch --fuzz=0 -p1 < /tmp/issue-938-offline-access-consent.patch \
  && apk del .inside-patch-tools \
  && cd packages/connectors/connector-smtp \
  && npm run check \
  && npm run build \
  && ! grep -q "instanceof Error" lib/index.js \
  && cd ../../../packages/phrases \
  && npm run build \
  && cd ../core \
  && npm run check \
  && rm -rf build \
  && ./node_modules/.bin/tsc -p tsconfig.test.json \
  && NODE_OPTIONS="--experimental-vm-modules --max_old_space_size=4096" ./node_modules/.bin/jest --runInBand build/sentinel/message-rate-guard.test.js build/middleware/koa-cimd-offline-access-consent-prompt.test.js \
  && sed -i '/onSuccess:/d' tsup.config.ts \
  && ./node_modules/.bin/tsup \
  && cd ../experience \
  && npm run check \
  && npm run build


COPY connector-inside-telegram /tmp/inside-telegram-connector
COPY fork/packages/core/src/routes/inside-telegram-theme.ts packages/core/src/routes/inside-telegram-theme.ts
COPY fork/packages/core/src/routes/inside-telegram-view.ts packages/core/src/routes/inside-telegram-view.ts
COPY fork/packages/core/src/routes/inside-telegram.ts packages/core/src/routes/inside-telegram.ts
COPY patches/issue-299-telegram-sign-in.patch /tmp/issue-299-telegram-sign-in.patch
RUN apk add --no-cache --virtual .inside-patch-tools patch \
  && patch --fuzz=0 -p1 < /tmp/issue-299-telegram-sign-in.patch \
  && apk del .inside-patch-tools \
  && mkdir -p packages/connectors/connector-inside-telegram/src \
  && cp /tmp/inside-telegram-connector/index.ts packages/connectors/connector-inside-telegram/src/index.ts \
  && cp /tmp/inside-telegram-connector/logo.svg /tmp/inside-telegram-connector/README.md packages/connectors/connector-inside-telegram/ \
  && cp packages/connectors/connector-github/tsconfig.json packages/connectors/connector-github/tsup.config.ts packages/connectors/connector-inside-telegram/ \
  && cp packages/connectors/connector-github/package.json packages/connectors/connector-inside-telegram/package.json \
  && sed -i 's/@logto\/connector-github/@logto\/connector-inside-telegram/g' packages/connectors/connector-inside-telegram/package.json \
  && ln -s ../connector-github/node_modules packages/connectors/connector-inside-telegram/node_modules \
  && cd packages/connectors/connector-inside-telegram \
  && npm run check && npm run build \
  && cd ../../core \
  && ln -s ../../connectors/connector-inside-telegram connectors/connector-inside-telegram \
  && sed -i "/outDir:/a\\  onSuccess: undefined," tsup.config.ts \
  && npm run check && ./node_modules/.bin/tsup
