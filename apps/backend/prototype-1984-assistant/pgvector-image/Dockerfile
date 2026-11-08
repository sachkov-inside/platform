# PROTOTYPE, throwaway (#1984). Check 3: pgvector built into the project's Postgres image.
FROM ghcr.io/sachkov-inside/postgres:18.4-alpine@sha256:9a8afca54e7861fd90fab5fdf4c42477a6b1cb7d293595148e674e0a3181de15 AS build
ARG PGVECTOR_VERSION=v0.8.1
RUN apk add --no-cache --virtual .build-deps build-base git \
 && git clone --depth 1 --branch ${PGVECTOR_VERSION} https://github.com/pgvector/pgvector.git /tmp/pgvector \
 && cd /tmp/pgvector && make OPTFLAGS="" with_llvm=no && make install with_llvm=no

FROM ghcr.io/sachkov-inside/postgres:18.4-alpine@sha256:9a8afca54e7861fd90fab5fdf4c42477a6b1cb7d293595148e674e0a3181de15
COPY --from=build /usr/local/lib/postgresql/vector.so /usr/local/lib/postgresql/
COPY --from=build /usr/local/share/postgresql/extension/vector* /usr/local/share/postgresql/extension/
