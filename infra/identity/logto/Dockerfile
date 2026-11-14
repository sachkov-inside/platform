FROM docker.io/library/node:26.13.1-alpine3.24@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5 AS security-node

FROM ghcr.io/logto-io/logto:1.46.0@sha256:d5e208ce705cbcf7c79ddba421216eb65413d0b0531aa658fb22a4ba659be983

# Upstream 1.46.0 still carries Node 26.13.0 and an older npm dependency tree.
COPY --from=security-node /usr/local/bin/node /usr/local/bin/node
RUN apk add --no-cache zlib=1.4-r0 \
  && npm install --global npm@12.2.2

LABEL org.opencontainers.image.source="https://github.com/sachkov-inside/platform"
LABEL org.opencontainers.image.version="1.46.0-inside.16"
LABEL inside.logto.upstream-revision="d179bf9d2d51104236a342b90c2841df66e4ba5b"

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

COPY fork/packages/core/src/routes/account-first-email.ts packages/core/src/routes/account-first-email.ts
COPY patches/account-first-email.patch /tmp/account-first-email.patch
RUN apk add --no-cache --virtual .inside-patch-tools patch \
  && patch --fuzz=0 -p1 < /tmp/account-first-email.patch \
  && apk del .inside-patch-tools \
  && cd packages/core && npm run check && ./node_modules/.bin/tsup

# Keep the refreshed upstream dependency graph reproducible, including private router fixes.
COPY security/upstream-tests.patch /tmp/inside-security-tests.patch
RUN apk add --no-cache --virtual .inside-test-patch-tools patch \
  && patch --fuzz=0 -p1 < /tmp/inside-security-tests.patch \
  && apk del .inside-test-patch-tools
COPY security/manifest-overlay.json security/apply-manifest-overlay.mjs security/router-security.mjs security/zod-security.mjs security/deepmerge-security.mjs /etc/logto/inside-security/
COPY security/patches /etc/logto/inside-security-patches
COPY security/pnpm-lock.yaml security/pnpm-workspace.yaml /etc/logto/
RUN npm install --global pnpm@10.34.9 \
  && node inside-security/apply-manifest-overlay.mjs \
  && rm -rf node_modules \
  && CI=true pnpm install --frozen-lockfile --ignore-scripts \
  && node --experimental-vm-modules inside-security/router-security.mjs \
  && node inside-security/zod-security.mjs \
  && node inside-security/deepmerge-security.mjs \
  && npm --prefix packages/core run check \
  && (cd packages/core \
    && ./node_modules/.bin/tsc -p tsconfig.test.json \
    && NODE_OPTIONS="--experimental-vm-modules --max_old_space_size=4096" ./node_modules/.bin/jest --runInBand \
      build/saml-application/SamlApplication/xml-format.test.js \
      build/saml-application/SamlApplication/signature.test.js \
      build/saml-application/SamlApplication/authn-policy.test.js \
      build/saml-application/SamlApplication/callback.test.js \
      build/libraries/saml-application/utils.test.js \
      build/sso/SamlConnector/sign.test.js \
      build/sso/SamlConnector/utils.test.js) \
  && npm --prefix packages/core run build \
  && npm --prefix packages/account run build \
  && npm --prefix packages/console run build \
  && npm --prefix packages/experience run build \
  && rm -rf node_modules \
  && CI=true pnpm install --prod --frozen-lockfile --ignore-scripts

# The CLI and server run compiled JavaScript. esbuild is needed only above during compilation.
RUN rm -rf node_modules/.pnpm/@esbuild+*/node_modules/@esbuild/*/bin

# The runtime invokes the compiled CLI and core directly. Package managers and their build caches
# are not needed for migrations, connector loading or serving the prebuilt browser applications.
RUN rm -rf /root/.local/share/pnpm /root/.cache /root/.npm \
  /usr/local/lib/node_modules/pnpm /usr/local/lib/node_modules/npm \
  /usr/local/bin/pnpm /usr/local/bin/pnpx /usr/local/bin/npm /usr/local/bin/npx
ENTRYPOINT []
CMD ["sh", "-c", "cd /etc/logto/packages/core && NODE_ENV=production exec node ."]
