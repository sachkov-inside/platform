FROM ghcr.io/logto-io/logto:1.41.0@sha256:7f79547e3d1fe569a3ecae757968a7cfc579687aa8164eec35113c0adc983c5b

LABEL org.opencontainers.image.source="https://github.com/sachkov-inside/platform"
LABEL org.opencontainers.image.version="1.41.0-inside.1"
LABEL inside.logto.upstream-revision="91e55698a42f99438cd41ec2b16a1fc51dbdab8a"

COPY fork/packages/experience/src/Layout/AppLayout/index.tsx packages/experience/src/Layout/AppLayout/index.tsx
COPY fork/packages/experience/src/Layout/AppLayout/index.module.scss packages/experience/src/Layout/AppLayout/index.module.scss
COPY fork/packages/experience/src/containers/VerificationCode/use-sign-in-flow-code-verification.ts packages/experience/src/containers/VerificationCode/use-sign-in-flow-code-verification.ts
COPY fork/packages/experience/src/utils/sign-in-experience.ts packages/experience/src/utils/sign-in-experience.ts

RUN cd packages/experience \
  && npm run check \
  && npm run build
