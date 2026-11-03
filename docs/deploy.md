# Deploy WowRouter

The desktop app still listens on `127.0.0.1:8787`. A server, container, or cluster can listen on another address. A non-loopback address will not start until password sign-in is on, or you set `WOWROUTER_PUBLIC_BIND=token` to say the bootstrap token is enough.

Password sign-in stays off until you turn it on. For a machine other people can reach, set `WOWROUTER_ADMIN_PASSWORD` (12–128 characters) before the first start, or turn it on in **Settings → Sign-in & sessions** while you are still on loopback.

## Config

Flags, environment variables, and a JSON file combine in that order: a flag wins over the environment, and the environment wins over the file. The password is only read from the environment, not the file.

```json
{
  "addr": "0.0.0.0:8787",
  "data_dir": "/data",
  "database_url": "postgres://wowrouter:secret@db:5432/wowrouter?sslmode=require",
  "tls_cert": "/data/tls.crt",
  "tls_key": "/data/tls.key",
  "tls_domain": "",
  "cors_origins": ["https://console.example.com"],
  "trusted_proxies": "10.0.0.0/8,127.0.0.1",
  "public_bind": "",
  "log_format": "json",
  "sync_peer": "https://other.example.com"
}
```

| Variable | Meaning |
| --- | --- |
| `WOWROUTER_ADDR` | Listen address. Default `127.0.0.1:8787`. |
| `WOWROUTER_DATA` | Data directory (`secret.key`, SQLite file, bootstrap token). |
| `WOWROUTER_DATABASE_URL` | `postgres://` or `postgresql://` to use Postgres. Empty keeps SQLite. |
| `WOWROUTER_TLS_CERT` / `WOWROUTER_TLS_KEY` | PEM files for built-in TLS. |
| `WOWROUTER_TLS_DOMAIN` | Enables ACME (Let's Encrypt) for that hostname. The process must be reachable on port 443. |
| `WOWROUTER_TRUSTED_PROXIES` | CIDRs allowed to set `X-Forwarded-For`. |
| `WOWROUTER_CORS_ORIGINS` | Comma-separated browser origins. |
| `WOWROUTER_PUBLIC_BIND` | `token` allows a public bind that uses the bootstrap token instead of a password. |
| `WOWROUTER_ADMIN_PASSWORD` | Sets the console password on first start when none is stored. |
| `WOWROUTER_LOG_FORMAT` | `json` for structured logs. |
| `WOWROUTER_SYNC_PEER` / `WOWROUTER_SYNC_TOKEN` | Pull a newer config snapshot from another WowRouter. Both sides need the same `secret.key`. |
| `WOWROUTER_CONFIG` | Path to the JSON file. Same as `-config`. |

`GET /health` is liveness. `GET /ready` checks the database. `GET /metrics` is Prometheus text. `POST /api/shutdown` from a non-loopback address requires an admin session.

API keys take `role` (`admin`, `operator`, `viewer`), `rpm`, and `quota_usd`. A viewer key can list models and cannot call them. Users are `POST /admin/v1/users` with `email`, `password`, and `role`.

Point clients at the public base URL:

```bash
WOWROUTER_URL=https://router.example.com WOWROUTER_TOKEN=sk-wowrouter-... wowrouter configure codex --write ./codex-config.toml
```

## Docker

The image listens on `0.0.0.0:8787` inside the container. Publish it on loopback unless you mean to expose it:

```bash
docker run -d --name wowrouter \
  -p 127.0.0.1:8787:8787 \
  -e WOWROUTER_PUBLIC_BIND=token \
  -v wowrouter:/data \
  foisalislambd/wowrouter:latest
```

For a host that is not loopback, drop `WOWROUTER_PUBLIC_BIND` and set `WOWROUTER_ADMIN_PASSWORD`. Postgres:

```bash
docker run -d --name wowrouter \
  -p 8787:8787 \
  -e WOWROUTER_ADMIN_PASSWORD='a long password' \
  -e WOWROUTER_DATABASE_URL='postgres://wowrouter:secret@db:5432/wowrouter?sslmode=disable' \
  -v wowrouter:/data \
  foisalislambd/wowrouter:latest
```

`secret.key` in the volume still encrypts the private column. Keep it with the database.

## Kubernetes

`deploy/helm/wowrouter` runs one replica with a persistent volume, liveness `/health`, and readiness `/ready`. Set `adminPassword` and, for more than one replica, `databaseUrl` (Postgres) so they share one database. SQLite on a single volume is the single-replica default.

```bash
helm install wowrouter deploy/helm/wowrouter \
  --set adminPassword='a long password' \
  --set service.type=ClusterIP
```

## TLS and a reverse proxy

Either give WowRouter the certificate files, or set `WOWROUTER_TLS_DOMAIN` and let it request one. Behind a proxy, terminate TLS there, send `X-Forwarded-For`, and list the proxy in `WOWROUTER_TRUSTED_PROXIES`. Do not put `*` in trusted proxies.

## Tunnel

`wowrouter relay 0.0.0.0:8791` with `WOWROUTER_TOKEN` set is a long-poll relay. Agents poll `/tunnel/poll` and post `/tunnel/respond`. This is a private relay you run, not an account with a tunnel vendor.

## Sync

`GET` or `PUT /admin/v1/sync/snapshot` with `Authorization: Bearer $WOWROUTER_SYNC_TOKEN` copies resource rows, including sealed secrets. A peer only reads them when it has the same `secret.key`. `WOWROUTER_SYNC_PEER` pulls once a minute when the peer generation is newer.
