FROM node:24-alpine AS build

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/backend/package.json ./apps/backend/package.json
COPY apps/backend/prisma.config.ts ./apps/backend/prisma.config.ts
COPY apps/backend/prisma ./apps/backend/prisma

RUN pnpm install --filter @inside/backend... --frozen-lockfile

COPY apps/backend/tsconfig.json apps/backend/tsconfig.build.json ./apps/backend/
COPY apps/backend/src ./apps/backend/src

RUN pnpm --filter @inside/backend build

RUN pnpm --config.inject-workspace-packages=true \
    --filter @inside/backend deploy --prod --ignore-scripts /prod/backend

FROM node:24-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production \
    API_HOST=0.0.0.0 \
    API_PORT=3001

COPY --from=build --chown=node:node /prod/backend/package.json ./apps/backend/package.json
COPY --from=build --chown=node:node /prod/backend/node_modules ./apps/backend/node_modules
COPY --from=build --chown=node:node /app/apps/backend/dist ./apps/backend/dist

EXPOSE 3001

USER node

CMD ["node", "apps/backend/dist/entrypoints/api.js"]