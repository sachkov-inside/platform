FROM node:24.19.0-alpine3.23@sha256:244cc2b53f46f9e876304391d17682b0ddae9ac33491f4857e25e35a36ba7995 AS toolchain

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

FROM development AS web
CMD ["pnpm", "--filter", "@inside/web", "dev", "--hostname", "0.0.0.0", "--port", "3000"]

FROM development AS storybook
CMD ["pnpm", "--filter", "@inside/web", "storybook", "--host", "0.0.0.0"]
