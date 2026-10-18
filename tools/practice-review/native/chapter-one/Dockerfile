FROM node:26.10.0-bookworm-slim@sha256:3ffc19ea878019d9e9ae8971732ad4a03cda44f167107173174b60ed7c65bed3
RUN apt-get update && apt-get install -y --no-install-recommends git ripgrep python3 ca-certificates curl chromium \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global @openai/codex@0.163.0
RUN mkdir -p /opt/chapter-fixture && npm install --prefix /opt/chapter-fixture \
    fastify@5.12.5 pg@8.23.1 vue@3.5.44 typescript@7.0.2 prettier@3.9.9 @types/node@26.6.4 @types/pg@8.23.1 playwright@1.63.0 oxlint@1.86.0
ENV CODEX_HOME=/home/node/.codex
RUN apt-get update && apt-get install -y --no-install-recommends iptables \
    && rm -rf /var/lib/apt/lists/*
USER node
WORKDIR /project
CMD ["sleep", "infinity"]
