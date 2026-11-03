# Changelog

Versions follow the `version` field in the root `package.json`. Releases are published from `main`.

## Unreleased

- `POST /v1/messages` and `POST /v1/responses` serve Claude Code and Responses clients. Combos can order by quota when a provider has sent rate-limit headers. Prompt compression, a response cache, and memory notes are off until Settings turns them on.
- The catalog includes extra OpenAI-compatible providers such as Gemini, Qwen, NVIDIA NIM, and local llama.cpp. Files and small batch jobs, an MCP tool endpoint, and an agent card are available on the same router key.
- Clients can write Claude Code, OpenCode, and Codex config on this computer after an explicit confirm. Each write keeps a backup and can be restored. OIDC is an optional panel sign-in next to the optional password. Both stay off until you enable them.
- TLS interception is not included. The router is an endpoint you configure on purpose, and installing a local certificate authority to capture other programs' HTTPS traffic is a poor fit for that.
- Routing presets `auto`, `auto/cheap`, `auto/fast`, and `auto/coding` pick among chat models that are already turned on. Named combos can use priority, round robin, weighted, cheapest, or least-used order.
- The panel has a Clients page with copy-paste setup for Cursor, OpenCode, Cline, and scripts. Usage shows the last 14 days. A router key can have an optional monthly USD cap.
- Successful calls record the route and, on non-streaming responses, send `X-WowRouter-*` cost and model headers.
- `GET /v1/models` accepts `q`, `kind`, `reasoning`, and `min_context`. `POST /v1/models/query` returns a short ranked list.
- The panel password is off by default. Settings can turn it on. The hash is bcrypt, the browser gets an HttpOnly session cookie, and `/v1` still uses router keys.
- The product name is WowRouter. npm, Docker Hub, and GitHub Packages still publish `airoute`, and they also publish `wowrouter`.
- Existing data stays in the `airoute-router` folder, in `airoute.db`. Router keys still start with `sk-airoute-`.

## 1.1.2

- Run WowRouter with Docker. The image is `foisalislambd/airoute` on Docker Hub and `ghcr.io/foisalislambd/airoute` on GitHub.
- The container listens on port 8787. Data is stored in `/data`.

## 1.1.0

This is the first release of the local Go router and the web panel.

- Install with `npm install -g airoute`, or download a desktop build from GitHub releases.
- The panel and the OpenAI-compatible API stay on `127.0.0.1:8787`.
- Chat, image, video, and decision calls use a router key that starts with `sk-airoute-`.
- On Windows, the desktop app can keep running after the window closes, with a tray icon and start-with-Windows.
- The same version is published to npm and to GitHub Packages as `@foisalislambd/airoute`.

Earlier npm versions were a previous codebase. They are not this router.
