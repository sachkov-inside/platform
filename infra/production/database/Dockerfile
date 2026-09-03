FROM postgres:18.4-alpine3.23@sha256:996d0920e4ff9df1fc19dacb904492f3c1ec0ec1cc338f0ad7123be7731c5f5e

ENV INSIDE_POSTGRES_DATA_PATH=/var/lib/postgresql/18/docker
ENV PGDATA=${INSIDE_POSTGRES_DATA_PATH}
ENV PGBACKREST_PG1_PATH=${INSIDE_POSTGRES_DATA_PATH}

RUN apk add --no-cache pgbackrest=2.57.0-r0

COPY init-production-databases.sh /docker-entrypoint-initdb.d/10-production-databases.sh
COPY restore-entrypoint.sh /usr/local/bin/inside-pgbackrest-restore
