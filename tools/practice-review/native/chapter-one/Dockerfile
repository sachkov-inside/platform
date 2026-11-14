FROM node:26.13.1-trixie-slim@sha256:e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc
RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends git ripgrep python3 ca-certificates curl chromium \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global npm@12.2.2 \
    && node -e 'const fs=require("node:fs"),f="/usr/local/lib/node_modules/npm/package.json",p=JSON.parse(fs.readFileSync(f));delete p.devDependencies;delete p.workspaces;p.dependencies.glob="14.0.3";p.dependencies.minimatch="11.0.1";p.overrides={...p.overrides,glob:"14.0.3",minimatch:"11.0.1"};fs.writeFileSync(f,JSON.stringify(p))' \
    && npm install --prefix /usr/local/lib/node_modules/npm --omit=dev --ignore-scripts --no-package-lock --fetch-retries=1 --fetch-timeout=30000 \
    && npm install --global @openai/codex@0.169.0
RUN mkdir -p /opt/chapter-fixture && npm install --prefix /opt/chapter-fixture \
    fastify@5.12.8 pg@8.23.1 vue@3.5.45 typescript@7.0.2 prettier@3.10.1 @types/node@26.6.6 @types/pg@8.23.1 playwright@1.65.0 oxlint@1.93.0
ENV CODEX_HOME=/home/node/.codex
RUN apt-get update && apt-get install -y --no-install-recommends iptables \
    && rm -rf /var/lib/apt/lists/*
USER node
WORKDIR /project
CMD ["sleep", "infinity"]
