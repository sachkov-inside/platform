FROM ghcr.io/sachkov-inside/node:26.10.0-alpine3.24@sha256:0b36e8c136b94cd4fcf02188228e76c31ad5872eef3fec8cbd2eee500cfd9e80 AS toolchain

ENV COREPACK_HOME=/corepack
RUN mkdir /corepack \
    && npm install --global corepack@0.36.0 \
    && corepack enable \
    && corepack install --global pnpm@11.27.1 \
    && chown -R node:node /corepack

WORKDIR /workspace
RUN chown node:node /workspace
USER node

FROM toolchain AS dependency-inputs

COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.node-lib.json ./
COPY --chown=node:node patches ./patches
COPY --chown=node:node apps/backend/package.json ./apps/backend/package.json
COPY --chown=node:node apps/backend/prisma.config.ts ./apps/backend/prisma.config.ts
COPY --chown=node:node apps/backend/prisma ./apps/backend/prisma
COPY --chown=node:node apps/web/package.json ./apps/web/package.json
COPY --chown=node:node apps/telegram/package.json ./apps/telegram/package.json
COPY --chown=node:node packages/runtime-identity/package.json ./packages/runtime-identity/package.json
# The block registry compiles during install, so its sources join the dependency stage.
COPY --chown=node:node packages/material-blocks ./packages/material-blocks
# Published legal editions compile the same way and the API serves their consent catalogue.
COPY --chown=node:node packages/legal ./packages/legal
# Словарь прав доступа тоже компилируется на установке: оба приложения читают его вывод.
COPY --chown=node:node packages/access-capabilities ./packages/access-capabilities
COPY --chown=node:node docs/contracts ./docs/contracts

FROM dependency-inputs AS dependencies

RUN --mount=type=cache,id=inside-platform-pnpm,target=/pnpm/store,uid=1000,gid=1000 \
    pnpm install --frozen-lockfile --store-dir=/pnpm/store --package-import-method=copy

FROM dependencies AS source

# Restore installed patch metadata after source COPY: pnpm checks its timestamps.
COPY --chown=node:node . .
COPY --from=dependencies --chown=node:node /workspace/patches ./patches

ENV TBANK_CA_FILE=/workspace/infra/tls/russian-trusted-root-ca.pem

FROM source AS development

# The production-web stand binds its API to this image's immutable release identity.
ARG INSIDE_RELEASE_VERSION=""
ARG INSIDE_SOURCE_SHA=""
USER root
RUN if [ -n "$INSIDE_RELEASE_VERSION" ] || [ -n "$INSIDE_SOURCE_SHA" ]; then \
      node packages/runtime-identity/write-release-identity.mjs \
        "$INSIDE_RELEASE_VERSION" "$INSIDE_SOURCE_SHA" \
        /workspace/apps/backend/release-identity.json \
      && chmod 0444 /workspace/apps/backend/release-identity.json; \
    fi
# All local roles share this image; the bank double's volume inherits its writable data directory.
RUN mkdir -p /data && chown node:node /data
USER node

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

FROM development AS billing-worker
CMD ["pnpm", "--filter", "@inside/backend", "dev:billing-worker"]

FROM development AS notifications-worker
# Compose owns recovery: watch would keep the container alive after the application exits.
CMD ["pnpm", "--filter", "@inside/backend", "exec", "tsx", "src/entrypoints/notifications-worker.ts"]

# Двойник банка существует только для стенда: цели production ниже его не собирают и не запускают.
FROM development AS bank-double

# Журнал двойника принадлежит процессу приложения, поэтому каталог тома создаётся с его владельцем:
# пустой именованный том наследует владельца каталога образа.
CMD ["pnpm", "--filter", "@inside/backend", "dev:bank-double"]

FROM dependency-inputs AS production-dependencies

# This store belongs only to this RUN. Keep installed files as copies and do not
# retain downloaded store content in the committed layer, even after install fails.
RUN set -eu; \
    backend_store="$(mktemp -d /tmp/inside-backend-pnpm.XXXXXX)"; \
    readonly backend_store; \
    install_status=0; \
    pnpm install --frozen-lockfile --store-dir="$backend_store" --package-import-method=copy --filter '@inside/backend...' || install_status=$?; \
    cleanup_status=0; \
    rm -rf -- "$backend_store" || cleanup_status=$?; \
    if [ "$install_status" -ne 0 ]; then exit "$install_status"; fi; \
    exit "$cleanup_status"

FROM production-dependencies AS production-source

# Restore the installed patch metadata from this isolated install after source COPY.
COPY --chown=node:node . .
COPY --from=production-dependencies --chown=node:node /workspace/patches ./patches

ENV TBANK_CA_FILE=/workspace/infra/tls/russian-trusted-root-ca.pem

FROM dependency-inputs AS production-build

# Install, compile, deploy and owned dependency cleanup share one committed lifetime.
COPY --chown=node:node . .
ENV TBANK_CA_FILE=/workspace/infra/tls/russian-trusted-root-ca.pem

RUN set -eu; \
    valid_decimal() { case "$1" in ''|*[!0-9]*|0[0-9]*) return 1 ;; esac; }; \
    valid_pair() { case "$1" in *:*:*) return 1 ;; *:*) ;; *) return 1 ;; esac; valid_decimal "${1%%:*}"; valid_decimal "${1#*:}"; }; \
    valid_triple() { valid_decimal "${1%%:*}"; valid_pair "${1#*:}"; }; \
    build_uid="$(id -u)"; \
    valid_decimal "$build_uid"; \
    readonly build_uid; \
    test -d /workspace; \
    test ! -L /workspace; \
    workspace_identity="$(stat -c '%d:%i:%u' -- /workspace)"; \
    valid_triple "$workspace_identity"; \
    test "${workspace_identity##*:}" = "$build_uid"; \
    readonly workspace_identity; \
    check_parents() { \
      for parent in /workspace/apps /workspace/apps/backend /workspace/docs /workspace/docs/contracts /workspace/packages /workspace/packages/access-capabilities /workspace/packages/legal /workspace/packages/material-blocks /workspace/packages/runtime-identity; do test -d "$parent"; test ! -L "$parent"; done; \
    }; \
    check_parents; \
    for dependency_root in /workspace/node_modules /workspace/apps/backend/node_modules /workspace/docs/contracts/node_modules /workspace/packages/access-capabilities/node_modules /workspace/packages/legal/node_modules /workspace/packages/material-blocks/node_modules /workspace/packages/runtime-identity/node_modules; do test ! -e "$dependency_root"; test ! -L "$dependency_root"; done; \
    test ! -e /workspace/.production; \
    test ! -L /workspace/.production; \
    mkdir /workspace/.production; \
    test -d /workspace/.production; \
    test ! -L /workspace/.production; \
    production_identity="$(stat -c '%d:%i:%u' -- /workspace/.production)"; \
    valid_triple "$production_identity"; \
    test "${production_identity##*:}" = "$build_uid"; \
    readonly production_identity; \
    check_ancestry() { \
      test -d /workspace; \
      test ! -L /workspace; \
      current_identity="$(stat -c '%d:%i:%u' -- /workspace)"; \
      valid_triple "$current_identity"; \
      test "$current_identity" = "$workspace_identity"; \
      test "${current_identity##*:}" = "$build_uid"; \
      test -d /workspace/.production; \
      test ! -L /workspace/.production; \
      current_identity="$(stat -c '%d:%i:%u' -- /workspace/.production)"; \
      valid_triple "$current_identity"; \
      test "$current_identity" = "$production_identity"; \
      test "${current_identity##*:}" = "$build_uid"; \
    }; \
    check_output() { \
      check_ancestry; \
      test -d /workspace/.production/backend; \
      test ! -L /workspace/.production/backend; \
      current_identity="$(stat -c '%d:%i:%u' -- /workspace/.production/backend)"; \
      valid_triple "$current_identity"; \
      test "$current_identity" = "$payload_identity"; \
      test "${current_identity##*:}" = "$build_uid"; \
      test -d /workspace/.production/backend/node_modules; \
      test ! -L /workspace/.production/backend/node_modules; \
      current_identity="$(stat -c '%d:%i:%u' -- /workspace/.production/backend/node_modules)"; \
      valid_triple "$current_identity"; \
      test "$current_identity" = "$payload_modules_identity"; \
      test "${current_identity##*:}" = "$build_uid"; \
      test -f /workspace/.production/backend/package.json; \
      test ! -L /workspace/.production/backend/package.json; \
    }; \
    backend_store="$(mktemp -d /tmp/inside-backend-pnpm.XXXXXX)"; \
    readonly backend_store; \
    install_status=0; \
    pnpm install --frozen-lockfile --store-dir="$backend_store" --package-import-method=copy --filter '@inside/backend...' || install_status=$?; \
    cleanup_status=0; \
    rm -rf -- "$backend_store" || cleanup_status=$?; \
    if [ "$install_status" -ne 0 ]; then exit "$install_status"; fi; \
    if [ "$cleanup_status" -ne 0 ]; then exit "$cleanup_status"; fi; \
    check_parents; \
    test -d /workspace/node_modules; \
    test ! -L /workspace/node_modules; \
    root_modules_identity="$(stat -c '%d:%i' -- /workspace/node_modules)"; \
    valid_pair "$root_modules_identity"; \
    readonly root_modules_identity; \
    test -d /workspace/apps/backend/node_modules; \
    test ! -L /workspace/apps/backend/node_modules; \
    backend_modules_identity="$(stat -c '%d:%i' -- /workspace/apps/backend/node_modules)"; \
    valid_pair "$backend_modules_identity"; \
    readonly backend_modules_identity; \
    test -d /workspace/docs/contracts/node_modules; \
    test ! -L /workspace/docs/contracts/node_modules; \
    contracts_modules_identity="$(stat -c '%d:%i' -- /workspace/docs/contracts/node_modules)"; \
    valid_pair "$contracts_modules_identity"; \
    readonly contracts_modules_identity; \
    test -d /workspace/packages/access-capabilities/node_modules; \
    test ! -L /workspace/packages/access-capabilities/node_modules; \
    access_modules_identity="$(stat -c '%d:%i' -- /workspace/packages/access-capabilities/node_modules)"; \
    valid_pair "$access_modules_identity"; \
    readonly access_modules_identity; \
    test -d /workspace/packages/legal/node_modules; \
    test ! -L /workspace/packages/legal/node_modules; \
    legal_modules_identity="$(stat -c '%d:%i' -- /workspace/packages/legal/node_modules)"; \
    valid_pair "$legal_modules_identity"; \
    readonly legal_modules_identity; \
    test -d /workspace/packages/material-blocks/node_modules; \
    test ! -L /workspace/packages/material-blocks/node_modules; \
    blocks_modules_identity="$(stat -c '%d:%i' -- /workspace/packages/material-blocks/node_modules)"; \
    valid_pair "$blocks_modules_identity"; \
    readonly blocks_modules_identity; \
    test -d /workspace/packages/runtime-identity/node_modules; \
    test ! -L /workspace/packages/runtime-identity/node_modules; \
    identity_modules_identity="$(stat -c '%d:%i' -- /workspace/packages/runtime-identity/node_modules)"; \
    valid_pair "$identity_modules_identity"; \
    readonly identity_modules_identity; \
    pnpm --filter @inside/backend build:production; \
    check_ancestry; \
    test ! -e /workspace/.production/backend; \
    test ! -L /workspace/.production/backend; \
    deploy_store=/tmp/inside-backend-deploy-store; \
    readonly deploy_store; \
    deploy_store_parent="$(dirname "$deploy_store")"; \
    readonly deploy_store_parent; \
    test -d "$deploy_store_parent"; \
    test ! -L "$deploy_store_parent"; \
    deploy_parent_identity="$(stat -c '%d:%i' -- "$deploy_store_parent")"; \
    valid_pair "$deploy_parent_identity"; \
    readonly deploy_parent_identity; \
    test ! -e "$deploy_store"; \
    test ! -L "$deploy_store"; \
    mkdir -m 0700 -- "$deploy_store"; \
    test -d "$deploy_store"; \
    test ! -L "$deploy_store"; \
    deploy_store_identity="$(stat -c '%d:%i:%u' -- "$deploy_store")"; \
    valid_triple "$deploy_store_identity"; \
    test "${deploy_store_identity##*:}" = "$build_uid"; \
    readonly deploy_store_identity; \
    check_deploy_store() { \
      test -d "$deploy_store_parent" || return 1; \
      test ! -L "$deploy_store_parent" || return 1; \
      current_identity="$(stat -c '%d:%i' -- "$deploy_store_parent")" || return 1; \
      valid_pair "$current_identity" || return 1; \
      test "$current_identity" = "$deploy_parent_identity" || return 1; \
      test -d "$deploy_store" || return 1; \
      test ! -L "$deploy_store" || return 1; \
      current_identity="$(stat -c '%d:%i:%u' -- "$deploy_store")" || return 1; \
      valid_triple "$current_identity" || return 1; \
      test "$current_identity" = "$deploy_store_identity" || return 1; \
      test "${current_identity##*:}" = "$build_uid" || return 1; \
      deploy_store_mode="$(stat -c '%a' -- "$deploy_store")" || return 1; \
      test "$deploy_store_mode" = 700 || return 1; \
    }; \
    check_deploy_store; \
    check_ancestry; \
    deploy_status=0; \
    pnpm --store-dir="$deploy_store" --config.inject-workspace-packages=true --filter @inside/backend deploy --prod --ignore-scripts /workspace/.production/backend || deploy_status=$?; \
    if [ "$deploy_status" -eq 0 ]; then \
      check_ancestry; \
      test -d /workspace/.production/backend; \
      test ! -L /workspace/.production/backend; \
      payload_identity="$(stat -c '%d:%i:%u' -- /workspace/.production/backend)"; \
      valid_triple "$payload_identity"; \
      test "${payload_identity##*:}" = "$build_uid"; \
      readonly payload_identity; \
      test -d /workspace/.production/backend/node_modules; \
      test ! -L /workspace/.production/backend/node_modules; \
      payload_modules_identity="$(stat -c '%d:%i:%u' -- /workspace/.production/backend/node_modules)"; \
      valid_triple "$payload_modules_identity"; \
      test "${payload_modules_identity##*:}" = "$build_uid"; \
      readonly payload_modules_identity; \
      check_output; \
    fi; \
    deploy_cleanup_status=0; \
    if check_deploy_store; then \
      rm -rf -- "$deploy_store" || deploy_cleanup_status=$?; \
      if [ "$deploy_cleanup_status" -eq 0 ]; then \
        test ! -e "$deploy_store" || deploy_cleanup_status=1; \
        test ! -L "$deploy_store" || deploy_cleanup_status=1; \
      fi; \
    else deploy_cleanup_status=1; fi; \
    if [ "$deploy_status" -ne 0 ]; then exit "$deploy_status"; fi; \
    if [ "$deploy_cleanup_status" -ne 0 ]; then exit "$deploy_cleanup_status"; fi; \
    check_output; \
    check_parents; \
    test -d /workspace/node_modules; \
    test ! -L /workspace/node_modules; \
    current_identity="$(stat -c '%d:%i' -- /workspace/node_modules)"; \
    valid_pair "$current_identity"; \
    test "$current_identity" = "$root_modules_identity"; \
    test -d /workspace/apps/backend/node_modules; \
    test ! -L /workspace/apps/backend/node_modules; \
    current_identity="$(stat -c '%d:%i' -- /workspace/apps/backend/node_modules)"; \
    valid_pair "$current_identity"; \
    test "$current_identity" = "$backend_modules_identity"; \
    test -d /workspace/docs/contracts/node_modules; \
    test ! -L /workspace/docs/contracts/node_modules; \
    current_identity="$(stat -c '%d:%i' -- /workspace/docs/contracts/node_modules)"; \
    valid_pair "$current_identity"; \
    test "$current_identity" = "$contracts_modules_identity"; \
    test -d /workspace/packages/access-capabilities/node_modules; \
    test ! -L /workspace/packages/access-capabilities/node_modules; \
    current_identity="$(stat -c '%d:%i' -- /workspace/packages/access-capabilities/node_modules)"; \
    valid_pair "$current_identity"; \
    test "$current_identity" = "$access_modules_identity"; \
    test -d /workspace/packages/legal/node_modules; \
    test ! -L /workspace/packages/legal/node_modules; \
    current_identity="$(stat -c '%d:%i' -- /workspace/packages/legal/node_modules)"; \
    valid_pair "$current_identity"; \
    test "$current_identity" = "$legal_modules_identity"; \
    test -d /workspace/packages/material-blocks/node_modules; \
    test ! -L /workspace/packages/material-blocks/node_modules; \
    current_identity="$(stat -c '%d:%i' -- /workspace/packages/material-blocks/node_modules)"; \
    valid_pair "$current_identity"; \
    test "$current_identity" = "$blocks_modules_identity"; \
    test -d /workspace/packages/runtime-identity/node_modules; \
    test ! -L /workspace/packages/runtime-identity/node_modules; \
    current_identity="$(stat -c '%d:%i' -- /workspace/packages/runtime-identity/node_modules)"; \
    valid_pair "$current_identity"; \
    test "$current_identity" = "$identity_modules_identity"; \
    rm -rf -- /workspace/node_modules /workspace/apps/backend/node_modules /workspace/docs/contracts/node_modules /workspace/packages/access-capabilities/node_modules /workspace/packages/legal/node_modules /workspace/packages/material-blocks/node_modules /workspace/packages/runtime-identity/node_modules; \
    check_output

FROM production-build AS release-identity

# Image identity is late: release-only changes do not invalidate the payload RUN.
ARG INSIDE_RELEASE_VERSION
ARG INSIDE_SOURCE_SHA
RUN set -eu; \
    valid_decimal() { case "$1" in ''|*[!0-9]*|0[0-9]*) return 1 ;; esac; }; \
    valid_pair() { case "$1" in *:*:*) return 1 ;; *:*) ;; *) return 1 ;; esac; valid_decimal "${1%%:*}"; valid_decimal "${1#*:}"; }; \
    valid_triple() { valid_decimal "${1%%:*}"; valid_pair "${1#*:}"; }; \
    build_uid="$(id -u)"; \
    valid_decimal "$build_uid"; \
    readonly build_uid; \
    test -d /workspace; \
    test ! -L /workspace; \
    workspace_identity="$(stat -c '%d:%i:%u' -- /workspace)"; \
    valid_triple "$workspace_identity"; \
    test "${workspace_identity##*:}" = "$build_uid"; \
    readonly workspace_identity; \
    test -d /workspace/.production; \
    test ! -L /workspace/.production; \
    production_identity="$(stat -c '%d:%i:%u' -- /workspace/.production)"; \
    valid_triple "$production_identity"; \
    test "${production_identity##*:}" = "$build_uid"; \
    readonly production_identity; \
    test -d /workspace/.production/backend; \
    test ! -L /workspace/.production/backend; \
    payload_identity="$(stat -c '%d:%i:%u' -- /workspace/.production/backend)"; \
    valid_triple "$payload_identity"; \
    test "${payload_identity##*:}" = "$build_uid"; \
    readonly payload_identity; \
    test -d /workspace/.production/backend/node_modules; \
    test ! -L /workspace/.production/backend/node_modules; \
    payload_modules_identity="$(stat -c '%d:%i:%u' -- /workspace/.production/backend/node_modules)"; \
    valid_triple "$payload_modules_identity"; \
    test "${payload_modules_identity##*:}" = "$build_uid"; \
    readonly payload_modules_identity; \
    check_identity_snapshot() { \
      test -d /workspace; \
      test ! -L /workspace; \
      current_identity="$(stat -c '%d:%i:%u' -- /workspace)"; \
      valid_triple "$current_identity"; \
      test "$current_identity" = "$workspace_identity"; \
      test "${current_identity##*:}" = "$build_uid"; \
      test -d /workspace/.production; \
      test ! -L /workspace/.production; \
      current_identity="$(stat -c '%d:%i:%u' -- /workspace/.production)"; \
      valid_triple "$current_identity"; \
      test "$current_identity" = "$production_identity"; \
      test "${current_identity##*:}" = "$build_uid"; \
      test -d /workspace/.production/backend; \
      test ! -L /workspace/.production/backend; \
      current_identity="$(stat -c '%d:%i:%u' -- /workspace/.production/backend)"; \
      valid_triple "$current_identity"; \
      test "$current_identity" = "$payload_identity"; \
      test "${current_identity##*:}" = "$build_uid"; \
      test -d /workspace/.production/backend/node_modules; \
      test ! -L /workspace/.production/backend/node_modules; \
      current_identity="$(stat -c '%d:%i:%u' -- /workspace/.production/backend/node_modules)"; \
      valid_triple "$current_identity"; \
      test "$current_identity" = "$payload_modules_identity"; \
      test "${current_identity##*:}" = "$build_uid"; \
      test -f /workspace/.production/backend/package.json; \
      test ! -L /workspace/.production/backend/package.json; \
    }; \
    check_identity_snapshot; \
    test ! -e /workspace/node_modules; \
    test ! -L /workspace/node_modules; \
    ln -s .production/backend/node_modules /workspace/node_modules; \
    check_identity_snapshot; \
    node packages/runtime-identity/write-release-identity.mjs "$INSIDE_RELEASE_VERSION" "$INSIDE_SOURCE_SHA" /workspace/release-identity.json

FROM ghcr.io/sachkov-inside/node:26.10.0-alpine3.24@sha256:0b36e8c136b94cd4fcf02188228e76c31ad5872eef3fec8cbd2eee500cfd9e80 AS backend-production

ENV NODE_ENV=production \
    API_HOST=0.0.0.0 \
    API_PORT=3001 \
    TBANK_CA_FILE=/app/infra/tls/russian-trusted-root-ca.pem
WORKDIR /app

# Корень для соединений с банком: владелец root, приложению доступен только на чтение.
# Каталог создаётся заранее: --chmod у COPY распространился бы и на него, закрыв вход внутрь.
RUN mkdir -p ./infra/tls
COPY --chown=root:root --chmod=0444 infra/tls/russian-trusted-root-ca.pem ./infra/tls/russian-trusted-root-ca.pem

COPY --from=production-build --chown=node:node /workspace/.production/backend/package.json ./package.json
COPY --from=production-build --chown=node:node /workspace/.production/backend/node_modules ./node_modules
COPY --from=production-build --chown=node:node /workspace/apps/backend/dist ./dist

COPY --chown=node:node packages/runtime-identity/index.mjs packages/runtime-identity/http-healthcheck.mjs ./healthcheck/

# Сторож production (#245): deploy-release копирует его из образа выбранного выпуска на сервер.
# Приложение его не запускает.
COPY --chown=root:root --chmod=0555 infra/production/watchdog/ ./ops/watchdog/

# Attach identity after the reusable payload so identity-only changes retain its cached layers.
COPY --from=release-identity --chown=root:root --chmod=0444 /workspace/release-identity.json ./release-identity.json

EXPOSE 3001
USER node
CMD ["node", "dist/entrypoints/api.js"]

FROM backend-production AS api-production
