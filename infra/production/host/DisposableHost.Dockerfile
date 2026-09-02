FROM ubuntu:24.04@sha256:33ceb71981b602c1a7443a53469e4dba065f7503eab3078a2d7a57a2ab987517

ENV DEBIAN_FRONTEND=noninteractive container=docker

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    dbus=1.14.10-4ubuntu4.1 \
    python3=3.12.3-0ubuntu2.1 \
    systemd=255.4-1ubuntu8.17 \
    systemd-sysv=255.4-1ubuntu8.17 \
  && apt-get clean \
  && find /var/lib/apt/lists -mindepth 1 -delete

STOPSIGNAL SIGRTMIN+3

CMD ["/sbin/init"]
