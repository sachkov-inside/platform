FROM node:24.19.0-alpine3.23 AS toolchain

ENV COREPACK_HOME=/corepack
RUN mkdir /corepack \
    && corepack enable \
    && corepack install --global pnpm@11.22.0 \
    && chown -R node:node /corepack

ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /workspace
RUN chown node:node /workspace
USER node

FROM toolchain AS dependencies

COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --chown=node:node apps/backend/package.json ./apps/backend/package.json
COPY --chown=node:node apps/backend/prisma.config.ts ./apps/backend/prisma.config.ts
COPY --chown=node:node apps/backend/prisma ./apps/backend/prisma
COPY --chown=node:node apps/web/package.json ./apps/web/package.json
COPY --chown=node:node packages/runtime-identity/package.json ./packages/runtime-identity/package.json
RUN --mount=type=cache,id=inside-platform-pnpm,target=/pnpm/store,uid=1000,gid=1000 \
    pnpm install --frozen-lockfile --store-dir=/pnpm/store --package-import-method=copy

FROM dependencies AS development

COPY --chown=node:node . .

FROM dependencies AS release-identity

ARG INSIDE_RELEASE_VERSION
ARG INSIDE_SOURCE_SHA
COPY --chown=node:node packages/runtime-identity ./packages/runtime-identity
RUN node packages/runtime-identity/write-release-identity.mjs \
      "$INSIDE_RELEASE_VERSION" \
      "$INSIDE_SOURCE_SHA" \
      /workspace/release-identity.json

FROM development AS web
CMD ["pnpm", "--filter", "@inside/web", "dev", "--hostname", "0.0.0.0", "--port", "3000"]

FROM development AS storybook
CMD ["pnpm", "--filter", "@inside/web", "storybook", "--host", "0.0.0.0"]

FROM development AS production-build

RUN pnpm --filter @inside/web build

FROM node:24.19.0-alpine3.23 AS web-production

ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000
WORKDIR /app

COPY --from=production-build --chown=node:node /workspace/apps/web/.next/standalone ./
COPY --from=production-build --chown=node:node /workspace/apps/web/.next/static ./apps/web/.next/static
COPY --from=release-identity --chown=root:root --chmod=0444 /workspace/release-identity.json ./apps/web/release-identity.json

COPY --chown=node:node packages/runtime-identity/index.mjs packages/runtime-identity/http-healthcheck.mjs ./apps/web/healthcheck/

EXPOSE 3000
USER node
CMD ["node", "apps/web/server.js"]
