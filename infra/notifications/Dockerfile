FROM public.ecr.aws/docker/library/rabbitmq:4.2.4-management-alpine@sha256:adac51a4a14a200b8eb928a12787564ed56e93fc55e789a73ec13e1e2eac7aef
RUN apk add --no-cache openssl
COPY rabbitmq.conf /etc/rabbitmq/rabbitmq.conf
COPY local-definitions.json /etc/rabbitmq/definitions.json
COPY start-local.sh /usr/local/bin/start-local-notifications
ENTRYPOINT ["sh", "/usr/local/bin/start-local-notifications"]
