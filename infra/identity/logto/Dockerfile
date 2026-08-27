FROM ghcr.io/logto-io/logto:1.41.0@sha256:7f79547e3d1fe569a3ecae757968a7cfc579687aa8164eec35113c0adc983c5b

LABEL org.opencontainers.image.source="https://github.com/sachkov-inside/platform"
LABEL org.opencontainers.image.version="1.41.0-inside.2"
LABEL inside.logto.upstream-revision="91e55698a42f99438cd41ec2b16a1fc51dbdab8a"

COPY fork/packages/experience/src/Layout/AppLayout/index.tsx packages/experience/src/Layout/AppLayout/index.tsx
COPY fork/packages/experience/src/Layout/AppLayout/index.module.scss packages/experience/src/Layout/AppLayout/index.module.scss
COPY fork/packages/experience/src/containers/VerificationCode/use-sign-in-flow-code-verification.ts packages/experience/src/containers/VerificationCode/use-sign-in-flow-code-verification.ts
COPY fork/packages/experience/src/utils/sign-in-experience.ts packages/experience/src/utils/sign-in-experience.ts
COPY patches/issue-116-logto-proof.patch /tmp/issue-116-logto-proof.patch

RUN apk add --no-cache --virtual .inside-patch-tools patch \
  && patch --fuzz=0 -p1 < /tmp/issue-116-logto-proof.patch \
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
