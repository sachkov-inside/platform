FROM node:24.19.0-alpine3.23 AS toolchain

ENV COREPACK_HOME=/corepack
RUN mkdir /corepack \
    && corepack enable \
    && corepack install --global pnpm@11.22.0 \
    && chown -R node:node /corepack

WORKDIR /workspace
RUN chown node:node /workspace
USER node

FROM toolchain AS dependencies

COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --chown=node:node apps/backend/package.json ./apps/backend/package.json
COPY --chown=node:node apps/backend/prisma.config.ts ./apps/backend/prisma.config.ts
COPY --chown=node:node apps/backend/prisma ./apps/backend/prisma
COPY --chown=node:node apps/web/package.json ./apps/web/package.json
RUN --mount=type=cache,id=inside-platform-pnpm,target=/pnpm/store,uid=1000,gid=1000 \
    pnpm install --frozen-lockfile --store-dir=/pnpm/store --package-import-method=copy

FROM dependencies AS development

COPY --chown=node:node . .

FROM development AS migrations
CMD ["pnpm", "--filter", "@inside/backend", "db:migrate"]

FROM development AS seed
CMD ["pnpm", "--filter", "@inside/backend", "db:seed"]

FROM development AS api
CMD ["pnpm", "--filter", "@inside/backend", "dev:api"]

FROM development AS mcp
CMD ["pnpm", "--filter", "@inside/backend", "dev:mcp"]

FROM development AS material-assets-worker
CMD ["pnpm", "--filter", "@inside/backend", "dev:material-assets-worker"]

FROM development AS profile-avatars-worker
CMD ["pnpm", "--filter", "@inside/backend", "dev:profile-avatars-worker"]

FROM development AS video-deletions-worker
CMD ["pnpm", "--filter", "@inside/backend", "dev:video-deletions-worker"]

FROM development AS production-build

RUN pnpm --filter @inside/backend build:production \
    && pnpm --config.inject-workspace-packages=true \
      --filter @inside/backend deploy --prod --ignore-scripts /workspace/.production/backend

FROM node:24.19.0-alpine3.23 AS backend-production

ENV NODE_ENV=production \
    API_HOST=0.0.0.0 \
    API_PORT=3001
WORKDIR /app

COPY --from=production-build --chown=node:node /workspace/.production/backend/package.json ./package.json
COPY --from=production-build --chown=node:node /workspace/.production/backend/node_modules ./node_modules
COPY --from=production-build --chown=node:node /workspace/apps/backend/dist ./dist

EXPOSE 3001
USER node
CMD ["node", "dist/entrypoints/api.js"]

FROM backend-production AS api-production
