FROM ghcr.io/sachkov-inside/rabbitmq:4.4.0-management-alpine@sha256:4841f6384ef8313c3594cd3f2e9f40c10805f8a61c45f08a9a5d9ddea8199267
RUN apk add --no-cache openssl zlib=1.4-r0
COPY rabbitmq.conf /etc/rabbitmq/rabbitmq.conf
COPY local-definitions.json /etc/rabbitmq/definitions.json
COPY start-local.sh /usr/local/bin/start-local-notifications
ENTRYPOINT ["sh", "/usr/local/bin/start-local-notifications"]
