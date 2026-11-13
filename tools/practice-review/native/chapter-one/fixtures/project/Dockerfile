FROM node:26.13.1-bookworm-slim@sha256:5df79989ed685e09f0a98019db4cebfb22fb9df1a53c0161664a011f7ff6b0f1
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
