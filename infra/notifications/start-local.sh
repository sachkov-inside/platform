#!/bin/sh
set -eu
# Disposable local CA/key. Persist the key across broker restarts; expose only the certificate.
mkdir -p /var/lib/rabbitmq/local-tls /local-ca
if [ ! -f /var/lib/rabbitmq/local-tls/key.pem ]; then
  openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
    -subj '/CN=rabbitmq' -addext 'subjectAltName=DNS:rabbitmq,DNS:localhost,IP:127.0.0.1' \
    -keyout /var/lib/rabbitmq/local-tls/key.pem -out /var/lib/rabbitmq/local-tls/cert.pem
fi
chmod 600 /var/lib/rabbitmq/local-tls/key.pem
cp /var/lib/rabbitmq/local-tls/cert.pem /local-ca/ca.pem
chmod 644 /local-ca/ca.pem
chown -R rabbitmq:rabbitmq /var/lib/rabbitmq/local-tls
exec docker-entrypoint.sh rabbitmq-server
