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
RUN --mount=type=cache,id=inside-platform-pnpm,target=/pnpm/store,uid=1000,gid=1000 \
    pnpm install --frozen-lockfile --store-dir=/pnpm/store --package-import-method=copy

FROM dependencies AS development

COPY --chown=node:node . .

FROM development AS bootstrap
CMD ["sh", "-c", "pnpm --filter @inside/backend db:migrate && pnpm --filter @inside/backend db:seed"]

FROM development AS api
CMD ["pnpm", "--filter", "@inside/backend", "dev:api"]

FROM development AS mcp
CMD ["pnpm", "--filter", "@inside/backend", "dev:mcp"]

FROM development AS material-assets-worker
CMD ["pnpm", "--filter", "@inside/backend", "dev:material-assets-worker"]

FROM development AS web
CMD ["pnpm", "--filter", "@inside/web", "dev", "--hostname", "0.0.0.0", "--port", "3000"]

FROM development AS storybook
CMD ["pnpm", "--filter", "@inside/web", "storybook", "--host", "0.0.0.0"]

FROM development AS backend-production-build

RUN pnpm --filter @inside/backend build:production \
    && pnpm --config.inject-workspace-packages=true \
      --filter @inside/backend deploy --prod --ignore-scripts /workspace/.production/backend

FROM development AS web-production-build

RUN pnpm --filter @inside/web build

FROM node:24.19.0-alpine3.23 AS api-production

ENV NODE_ENV=production \
    API_HOST=0.0.0.0 \
    API_PORT=3001
WORKDIR /app

COPY --from=backend-production-build --chown=node:node /workspace/.production/backend/package.json ./package.json
COPY --from=backend-production-build --chown=node:node /workspace/.production/backend/node_modules ./node_modules
COPY --from=backend-production-build --chown=node:node /workspace/apps/backend/dist ./dist

EXPOSE 3001
USER node
CMD ["node", "dist/entrypoints/api.js"]

FROM node:24.19.0-alpine3.23 AS web-production

ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000
WORKDIR /app

COPY --from=web-production-build --chown=node:node /workspace/apps/web/.next/standalone ./
COPY --from=web-production-build --chown=node:node /workspace/apps/web/.next/static ./apps/web/.next/static

EXPOSE 3000
USER node
CMD ["node", "apps/web/server.js"]
