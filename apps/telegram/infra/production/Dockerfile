# Root repository build context for independent telegram-release.yml.
FROM ghcr.io/sachkov-inside/node:26.13.1-alpine3.24@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5 AS toolchain
RUN apk add --no-cache zlib=1.4-r0 \
    && npm install --global npm@12.2.2 \
    && npm install --global corepack@0.36.0 \
    && corepack enable \
    && corepack install --global pnpm@12.18.0

FROM toolchain AS build
WORKDIR /workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.node-lib.json tsconfig.nest-app.json ./
COPY patches ./patches
COPY apps/backend/package.json ./apps/backend/package.json
COPY apps/backend/prisma.config.ts ./apps/backend/prisma.config.ts
COPY apps/backend/prisma ./apps/backend/prisma
COPY apps/web/package.json ./apps/web/package.json
COPY apps/telegram/package.json ./apps/telegram/package.json
COPY packages/runtime-identity/package.json ./packages/runtime-identity/package.json
COPY packages/material-blocks ./packages/material-blocks
COPY packages/legal ./packages/legal
COPY packages/access-capabilities ./packages/access-capabilities
COPY --chown=node:node docs/contracts ./docs/contracts
RUN pnpm install --frozen-lockfile
COPY apps/telegram/tsconfig.json apps/telegram/tsconfig.build.json ./apps/telegram/
COPY apps/telegram/src ./apps/telegram/src
# Deploy verifies a new production lockfile. Allow registry metadata requests:
# a frozen install can verify package age without caching full metadata (#1224).
RUN pnpm --filter @inside/telegram build \
    && pnpm --config.inject-workspace-packages=true \
      --filter @inside/telegram deploy --prod --ignore-scripts --frozen-lockfile /workspace/.production/telegram

FROM ghcr.io/sachkov-inside/node:26.13.1-alpine3.24@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5
RUN apk add --no-cache zlib=1.4-r0 \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
ARG SOURCE_COMMIT
LABEL org.opencontainers.image.revision=$SOURCE_COMMIT
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /workspace/.production/telegram/package.json ./
COPY --from=build --chown=node:node /workspace/.production/telegram/node_modules ./node_modules
COPY --from=build --chown=node:node /workspace/apps/telegram/dist ./dist
USER node
EXPOSE 3002
CMD ["node", "dist/main.js"]
