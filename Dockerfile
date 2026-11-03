FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS panel
WORKDIR /src
COPY package.json package-lock.json ./
COPY apps/panel/package.json apps/panel/package.json
COPY packages/sse/package.json packages/sse/package.json
RUN npm ci
COPY apps/panel apps/panel
COPY packages/sse packages/sse
RUN npm run build:panel

FROM --platform=$BUILDPLATFORM golang:1.26.5-bookworm AS server
WORKDIR /src
COPY apps/server/go.mod apps/server/go.sum ./
RUN go mod download
COPY apps/server ./
ARG TARGETOS
ARG TARGETARCH
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -ldflags "-s -w" -o /out/wowrouter ./cmd/wowrouter

FROM alpine:3.22
RUN apk add --no-cache ca-certificates wget su-exec \
  && adduser -D -H -u 10001 wowrouter
COPY --from=server /out/wowrouter /usr/local/bin/wowrouter
COPY --from=panel /src/apps/panel/dist /panel
RUN ln -s wowrouter /usr/local/bin/airoute \
  && printf '%s\n' \
  '#!/bin/sh' \
  'set -e' \
  'mkdir -p /data' \
  'chown -R wowrouter:wowrouter /data' \
  'exec su-exec wowrouter /usr/local/bin/wowrouter "$@"' \
  > /entrypoint.sh && chmod 755 /entrypoint.sh
ENV WOWROUTER_IN_DOCKER=1
ENV AIROUTE_IN_DOCKER=1
EXPOSE 8787
VOLUME /data
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8787/health | grep -Eq '"service":"(wowrouter|airoute)"' || exit 1
ENTRYPOINT ["/entrypoint.sh"]
CMD ["-addr", "0.0.0.0:8787", "-data", "/data", "-web", "/panel"]
