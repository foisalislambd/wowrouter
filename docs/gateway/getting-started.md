# Getting started

WowRouter serves one web panel at `http://127.0.0.1:8787/`. The same process serves the OpenAI-compatible API at `http://127.0.0.1:8787/v1`.

```bash
npm install
npm run build:panel
go run ./apps/server/cmd/wowrouter
```

The first start writes `bootstrap-token` in the data folder and prints it once. Open `/` and paste that token.

From there you can save a provider key, turn a model on, create a router key that starts with `sk-wowrouter-`, and call `/v1/chat/completions`.

`/ui` redirects to `/`.

Old installs are read on startup. Providers, provider keys, models, fallbacks, settings, and recent history move into `wowrouter.db`. Old router keys are not imported. Create new ones in the panel. The old files are left in place.

## Docker

The image in this repository builds the panel and serves it at `/` on port 8787. The bootstrap token is written into the `/data` volume on first start. See [Docker](../docker.md).
