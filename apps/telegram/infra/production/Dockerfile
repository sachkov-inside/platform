# Root repository build context for independent telegram-release.yml.
FROM node:26.10.0-bookworm-slim@sha256:662933cf47f013bc8e4beb31a6116448427a82057ba7c42c97e4c5ba766504c2 AS toolchain
RUN npm install --global corepack@0.36.0 \
    && corepack enable \
    && corepack install --global pnpm@11.27.1

FROM toolchain AS build
WORKDIR /workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.node-lib.json tsconfig.nest-app.json ./
COPY apps/backend/package.json ./apps/backend/package.json
COPY apps/backend/prisma.config.ts ./apps/backend/prisma.config.ts
COPY apps/backend/prisma ./apps/backend/prisma
COPY apps/web/package.json ./apps/web/package.json
COPY apps/telegram/package.json ./apps/telegram/package.json
COPY packages/runtime-identity/package.json ./packages/runtime-identity/package.json
COPY packages/material-blocks ./packages/material-blocks
COPY packages/legal ./packages/legal
COPY packages/access-capabilities ./packages/access-capabilities
RUN pnpm install --frozen-lockfile
COPY apps/telegram/tsconfig.json apps/telegram/tsconfig.build.json ./apps/telegram/
COPY apps/telegram/src ./apps/telegram/src
RUN pnpm --filter @inside/telegram build \
    && pnpm --config.inject-workspace-packages=true \
      --filter @inside/telegram deploy --prod --ignore-scripts --offline --frozen-lockfile /workspace/.production/telegram

FROM node:26.10.0-bookworm-slim@sha256:662933cf47f013bc8e4beb31a6116448427a82057ba7c42c97e4c5ba766504c2
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
