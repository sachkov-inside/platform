FROM ghcr.io/sachkov-inside/postgres:18.4-alpine3.23@sha256:996d0920e4ff9df1fc19dacb904492f3c1ec0ec1cc338f0ad7123be7731c5f5e AS postgres-base

FROM postgres-base AS pgbackrest-build

ENV PKG_CONFIG_PATH=/usr/local/lib/pkgconfig

# Stable Alpine 3.23 packages available on both x86_64 and aarch64. No edge repository.
# Selected libpq pkg-config metadata requires libcurl.pc during Meson setup.
RUN apk add --no-cache \
    build-base=0.5-r3 \
    meson=1.9.1-r0 \
    pkgconf=2.5.1-r0 \
    samurai=1.2-r7 \
    bzip2-dev=1.0.8-r6 \
    curl-dev=8.22.0-r0 \
    libpq-dev=18.6-r0 \
    libxml2-dev=2.13.9-r1 \
    lz4-dev=1.10.0-r0 \
    openssl-dev=3.5.9-r0 \
    libssh2-dev=1.11.1-r3 \
    zlib-dev=1.3.2-r1 \
    zstd-dev=1.5.7-r2

# Bind compilation to the PostgreSQL installed by the pinned base, not Alpine's libpq APK.
COPY libpq-version.c /build/libpq-version.c
RUN test "$(pkg-config --modversion libpq)" = "18.4" \
    && test "$(pkg-config --variable=pcfiledir libpq)" = "/usr/local/lib/pkgconfig" \
    && cc $(pkg-config --cflags libpq libcrypto) /build/libpq-version.c -o /build/libpq-version $(pkg-config --libs libpq libcrypto) \
    && printf '%s\n' '{"libpqVersion":"18.4","libpqPcDirectory":"/usr/local/lib/pkgconfig","pgBackRestSource":"46cdca625a73403cad4774d97354a1fac1e91e51","distributionSha256":"14037901db002e5536a948bf9f0fc0ff6cde31f4e675d3e9b46f129071bf2e5f"}' > /build/pgbackrest-build.json

# Official distribution asset includes generated sources; GitHub archive/checkout is not equivalent.
# SHA256 matches the official release asset digest and its published .sha256sum file.
ADD --checksum=sha256:14037901db002e5536a948bf9f0fc0ff6cde31f4e675d3e9b46f129071bf2e5f https://github.com/pgbackrest/pgbackrest/releases/download/release/2.59.3/pgbackrest-2.59.3.tar.gz /build/pgbackrest.tar.gz
# Keep only installed COPY inputs in this successful build layer. Both temporary
# roots must be newly constructed here and retain their identities before removal.
RUN test -d /build && test ! -L /build \
    && test ! -e /build/source && test ! -L /build/source \
    && test ! -e /build/output && test ! -L /build/output \
    && mkdir /build/source \
    && foundation_source_identity="$(stat -c '%d:%i' -- /build/source)" \
    && readonly foundation_source_identity \
    && case "$foundation_source_identity" in ''|*[!0-9:]*|:*|*:|*:*:*) exit 1;; esac \
    && test "$foundation_source_identity" != "${foundation_source_identity#*:}" \
    && tar -xzf /build/pgbackrest.tar.gz -C /build/source --strip-components=1 \
    && test -f /build/source/dist \
    && meson setup /build/output /build/source --prefix=/usr --buildtype=release --wrap-mode=nodownload \
       -Db_pie=true -Dstrip=true \
       -Dc_args='-fstack-protector-strong -D_FORTIFY_SOURCE=2' \
       -Dc_link_args='-Wl,-z,relro,-z,now' \
       -Dlibssh2=enabled -Dlibzstd=enabled -Dlibsystemd=disabled \
    && test -d /build/output && test ! -L /build/output \
    && foundation_output_identity="$(stat -c '%d:%i' -- /build/output)" \
    && readonly foundation_output_identity \
    && case "$foundation_output_identity" in ''|*[!0-9:]*|:*|*:|*:*:*) exit 1;; esac \
    && test "$foundation_output_identity" != "${foundation_output_identity#*:}" \
    && meson compile -C /build/output --jobs 2 \
    && meson install -C /build/output --no-rebuild --destdir /build/install \
    && test -d /build && test ! -L /build \
    && test -d /build/source && test ! -L /build/source \
    && test -d /build/output && test ! -L /build/output \
    && foundation_current_source_identity="$(stat -c '%d:%i' -- /build/source)" \
    && test "$foundation_current_source_identity" = "$foundation_source_identity" \
    && foundation_current_output_identity="$(stat -c '%d:%i' -- /build/output)" \
    && test "$foundation_current_output_identity" = "$foundation_output_identity" \
    && rm -rf -- /build/source /build/output

FROM postgres-base

ENV INSIDE_POSTGRES_DATA_PATH=/var/lib/postgresql/18/docker
ENV PGDATA=${INSIDE_POSTGRES_DATA_PATH}
ENV PGBACKREST_PG1_PATH=${INSIDE_POSTGRES_DATA_PATH}

RUN apk add --no-cache \
    libbz2=1.0.8-r6 \
    lz4-libs=1.10.0-r0 \
    libpq=18.6-r0 \
    libssh2=1.11.1-r3 \
    libxml2=2.13.9-r1 \
    libcrypto3=3.5.9-r0 \
    libssl3=3.5.9-r0 \
    zlib=1.3.2-r1 \
    zstd-libs=1.5.7-r2 \
    && install -d -m 755 /etc/pgbackrest/conf.d \
    && install -d -m 750 -o postgres -g postgres /var/log/pgbackrest /var/lib/pgbackrest \
    && install -d -m 700 -o postgres -g postgres /var/spool/pgbackrest
COPY --from=pgbackrest-build /build/install/usr/bin/pgbackrest /usr/bin/pgbackrest
COPY --from=pgbackrest-build /build/libpq-version /usr/libexec/inside/libpq-version
COPY --from=pgbackrest-build /build/pgbackrest-build.json /usr/share/inside/pgbackrest-build.json
RUN pgbackrest --version && test "$(/usr/libexec/inside/libpq-version)" = "180004"

COPY init-production-databases.sh /docker-entrypoint-initdb.d/10-production-databases.sh
COPY restore-entrypoint.sh /usr/local/bin/inside-pgbackrest-restore
