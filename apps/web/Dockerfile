FROM node:24-alpine AS build

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/package.json

RUN pnpm install --filter @inside/web... --frozen-lockfile

COPY apps/web/next-env.d.ts ./apps/web/next-env.d.ts
COPY apps/web/next.config.ts apps/web/postcss.config.mjs ./apps/web/
COPY apps/web/tsconfig.json apps/web/tsconfig.next.json ./apps/web/
COPY apps/web/app ./apps/web/app
COPY apps/web/src ./apps/web/src

RUN pnpm --filter @inside/web build

FROM node:24-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000

COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static

EXPOSE 3000

USER node

CMD ["node", "apps/web/server.js"]
