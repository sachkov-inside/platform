FROM ghcr.io/logto-io/logto:1.41.0@sha256:7f79547e3d1fe569a3ecae757968a7cfc579687aa8164eec35113c0adc983c5b

LABEL org.opencontainers.image.source="https://github.com/sachkov-inside/platform"
LABEL org.opencontainers.image.version="1.41.0-inside.3"
LABEL inside.logto.upstream-revision="91e55698a42f99438cd41ec2b16a1fc51dbdab8a"

COPY fork/packages/experience/src/Layout/AppLayout/index.tsx packages/experience/src/Layout/AppLayout/index.tsx
COPY fork/packages/experience/src/Layout/AppLayout/index.module.scss packages/experience/src/Layout/AppLayout/index.module.scss
COPY fork/packages/experience/src/containers/VerificationCode/use-sign-in-flow-code-verification.ts packages/experience/src/containers/VerificationCode/use-sign-in-flow-code-verification.ts
COPY fork/packages/experience/src/utils/sign-in-experience.ts packages/experience/src/utils/sign-in-experience.ts
COPY patches/issue-116-logto-proof.patch /tmp/issue-116-logto-proof.patch
COPY patches/issue-299-unified-sign-in.patch /tmp/issue-299-unified-sign-in.patch

RUN apk add --no-cache --virtual .inside-patch-tools patch \
  && patch --fuzz=0 -p1 < /tmp/issue-116-logto-proof.patch \
  && patch --fuzz=0 -p1 < /tmp/issue-299-unified-sign-in.patch \
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
  && NODE_OPTIONS="--experimental-vm-modules --max_old_space_size=4096" ./node_modules/.bin/jest --runInBand build/sentinel/message-rate-guard.test.js \
  && sed -i '/onSuccess:/d' tsup.config.ts \
  && ./node_modules/.bin/tsup \
  && cd ../experience \
  && npm run check \
  && npm run build


COPY connector-inside-telegram /tmp/inside-telegram-connector
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
