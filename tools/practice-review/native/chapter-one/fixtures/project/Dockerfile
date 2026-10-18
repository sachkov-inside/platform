FROM node:26.10.0-bookworm-slim@sha256:3ffc19ea878019d9e9ae8971732ad4a03cda44f167107173174b60ed7c65bed3
RUN apt-get update && apt-get install -y --no-install-recommends chromium ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /project
RUN chown node:node /project
COPY package.json ./
RUN npm install
COPY --chown=node:node apps ./apps
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node tsconfig.json ./
COPY --chown=node:node .oxlintrc.json ./
USER node
