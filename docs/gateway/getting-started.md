# Gateway console

WowRouter keeps its local panel at `http://127.0.0.1:8787` and also serves the gateway console at `http://127.0.0.1:8787/ui/`. Both listen on the same port. The panel is the existing router UI. The console is the admin UI for providers, virtual models, routing, keys, guardrails, budgets, and the request log.

## Build the console

The console is a static Next.js export. It is not committed.

```bash
cd apps/console
pnpm install
pnpm build
```

You need Node.js 22 or newer and pnpm 11. From the repo root, start the server so it can see `apps/console/out`:

```bash
WOWROUTER_SAMPLE_DATA=1 go run ./apps/server/cmd/wowrouter -addr 127.0.0.1:8787
```

`WOWROUTER_SAMPLE_DATA=1` inserts a local catalog (OpenAI and Anthropic providers, two deployments, a fallback route, models `chat` and `fast`, guardrails, a sample key, and alert rows). It does not store provider secrets and it does not invent request history. Leave the variable unset for an empty catalog.

Open `http://127.0.0.1:8787/ui/login/` and sign in with the admin token.

## Admin token

The first start writes `bootstrap-token` (mode 0600) in the data directory and prints the token once. The default data directory is `~/.config/airoute-router`. Pass `-data` to choose another folder. Later starts do not print the token; read the file:

```bash
cat ~/.config/airoute-router/bootstrap-token
```

The token starts with `ak-wowrouter-`. Paste it into **Admin token** on the sign-in page. The console then keeps an HttpOnly session cookie (`wowrouter_session`). The classic panel at `/` does not use this login.

Gateway configuration is stored in `gateway.db` in that same data directory, next to the existing `airoute.db`.

## First request

Virtual models are names without a slash, such as `chat`. Classic provider models stay `provider/model`, such as `openai/gpt-4o-mini`, and keep the existing router path.

1. In the console, open **Providers**, edit `openai`, and set an API key (or point the base URL at a local mock).
2. Open **API keys** and create a key. The secret is shown once and starts with `sk-wowrouter-`.
3. Call the model:

```bash
curl http://127.0.0.1:8787/v1/chat/completions \
  -H "Authorization: Bearer sk-wowrouter-…" \
  -H "Content-Type: application/json" \
  -d '{"model":"chat","messages":[{"role":"user","content":"hello"}]}'
```

The same port also accepts Anthropic-shaped `POST /v1/messages`, Gemini `POST /v1beta/models/{model}:generateContent`, and Bedrock-shaped `POST /model/{model}/converse` for those virtual model names. A model id that contains `/` is still the classic router.

## Docker

The image in this repository builds the console and serves it at `/ui/` on port 8787, next to the panel. The bootstrap token is written into the `/data` volume on first start. See [Docker](../docker.md) for the published image and the panel. The published Hub image includes the console only after it is rebuilt from this Dockerfile.
