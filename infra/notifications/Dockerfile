FROM rabbitmq:4.2.4-management-alpine
RUN apk add --no-cache openssl
COPY rabbitmq.conf /etc/rabbitmq/rabbitmq.conf
COPY local-definitions.json /etc/rabbitmq/definitions.json
COPY start-local.sh /usr/local/bin/start-local-notifications
ENTRYPOINT ["sh", "/usr/local/bin/start-local-notifications"]
