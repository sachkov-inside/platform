FROM node:26.13.1-trixie-slim@sha256:e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc
RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends chromium ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /project
RUN chown node:node /project
COPY package.json ./
RUN npm install --global npm@12.2.2 && npm install
COPY --chown=node:node apps ./apps
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node tsconfig.json ./
COPY --chown=node:node .oxlintrc.json ./
USER node
