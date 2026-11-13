FROM node:26.13.1-bookworm-slim@sha256:5df79989ed685e09f0a98019db4cebfb22fb9df1a53c0161664a011f7ff6b0f1
RUN apt-get update && apt-get install -y --no-install-recommends git ripgrep python3 ca-certificates curl chromium \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global npm@12.2.2 \
    && npm install --global @openai/codex@0.169.0
RUN mkdir -p /opt/chapter-fixture && npm install --prefix /opt/chapter-fixture \
    fastify@5.12.8 pg@8.23.1 vue@3.5.45 typescript@7.0.2 prettier@3.10.1 @types/node@26.6.6 @types/pg@8.23.1 playwright@1.65.0 oxlint@1.93.0
ENV CODEX_HOME=/home/node/.codex
RUN apt-get update && apt-get install -y --no-install-recommends iptables \
    && rm -rf /var/lib/apt/lists/*
USER node
WORKDIR /project
CMD ["sleep", "infinity"]
