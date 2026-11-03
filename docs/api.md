# API

The API is OpenAI-shaped and local. Every call below uses:

```text
http://127.0.0.1:8787
Authorization: Bearer sk-airoute-...
```

Create the bearer key in the panel under **API keys**. Provider keys stay in the panel. Do not send those to this API.

`GET /health` is the exception. It needs no key. It answers `{"service":"wowrouter","status":"ok"}` when this process is WowRouter. An older process may still answer `"service":"airoute"`.

## List models

```bash
curl http://127.0.0.1:8787/v1/models \
  -H "Authorization: Bearer sk-airoute-..."
```

You see models that are turned on, plus `auto`, `auto/cheap`, `auto/fast`, `auto/coding`, and any combo ids. Optional filters: `q`, `kind`, `reasoning=true`, and `min_context`.

```bash
curl "http://127.0.0.1:8787/v1/models?kind=chat&q=gpt" \
  -H "Authorization: Bearer sk-airoute-..."
```

`POST /v1/models/query` ranks the chat models that are ready. `profile` is `balanced`, `cheap`, `fast`, or `coding`. `limit` defaults to 5.

```bash
curl http://127.0.0.1:8787/v1/models/query \
  -H "Authorization: Bearer sk-airoute-..." \
  -H "Content-Type: application/json" \
  -d "{\"profile\":\"coding\",\"limit\":5}"
```

## Chat

```bash
curl http://127.0.0.1:8787/v1/chat/completions \
  -H "Authorization: Bearer sk-airoute-..." \
  -H "Content-Type: application/json" \
  -d "{\"model\":\"openai/gpt-4o-mini\",\"messages\":[{\"role\":\"user\",\"content\":\"Hello\"}]}"
```

Streaming works the same way as OpenAI: set `"stream": true`. Tools and the usual chat fields are forwarded to providers that speak the OpenAI chat API.

The model id must include the provider slug. `gpt-4o-mini` alone is not enough. Use `openai/gpt-4o-mini`.

A combo id such as `fallback/writing` is valid here when you created that chain in the panel. `auto` and `auto/cheap`, `auto/fast`, and `auto/coding` choose among turned-on chat models.

On a successful non-streaming response the router sets:

| Header | Meaning |
| --- | --- |
| `X-WowRouter-Model` | The model that answered |
| `X-WowRouter-Strategy` | `direct`, `auto`, `auto/cheap`, `auto/fast`, `auto/coding`, or the combo strategy |
| `X-WowRouter-Asked` | The model id the client sent |
| `X-WowRouter-Cost-Usd` | Estimated cost from catalog prices, when usage was reported |
| `X-WowRouter-Prompt-Tokens` | Prompt tokens, when reported |
| `X-WowRouter-Completion-Tokens` | Completion tokens, when reported |

Streaming responses include the model and strategy headers. Token totals arrive at the end of the stream, after the headers have already been sent.

A router key can have a monthly USD cap, set when you create it. Spend is estimated from successful calls in the current UTC month. The next call after the cap returns HTTP 429.

Combo strategies also include `fill-first`, `headroom`, `reset-window`, `quota-weighted`, and `quota-share`. Those use rate-limit headers the provider sent on an earlier call. When a provider has not sent any, the combo keeps the saved order.

`X-WowRouter-No-Cache: 1` skips the response cache. `X-WowRouter-No-Memory: 1` skips memory notes. Both features are off until Settings turns them on. Light compression only collapses extra spaces in text message content.

A cached non-streaming reply sets `X-WowRouter-Cache: hit`.

## Messages and Responses

Claude Code calls `POST /v1/messages` on the router origin, with no `/v1` in `ANTHROPIC_BASE_URL`. The router key is `ANTHROPIC_AUTH_TOKEN`. A bare Claude model id is accepted when that upstream id is unique. Other models are translated to and from chat completions, including tool calls. Set `"stream": true` for Anthropic server-sent events.

`POST /v1/messages/count_tokens` returns a local estimate. `POST /v1/responses` accepts a Responses API body and returns a Responses object, which Codex-style clients use.

## Files, batches, MCP, and agent cards

`POST /v1/files` accepts a multipart upload. `POST /v1/batches` runs a JSONL file of at most 40 `/v1/chat/completions` lines on this computer and stores the output as another file. `GET /v1/files/{id}/content` reads a file back.

`POST /mcp` speaks a small JSON-RPC tool surface (`initialize`, `tools/list`, `tools/call`) for `list_models` and `complete_chat`. `GET /.well-known/agent-card.json` and `POST /a2a` expose the same router to an agent client. All of these, except the public agent card, use a router key.

## Images

```bash
curl http://127.0.0.1:8787/v1/images/generations \
  -H "Authorization: Bearer sk-airoute-..." \
  -H "Content-Type: application/json" \
  -d "{\"model\":\"provider/image-model\",\"prompt\":\"A small red boat\"}"
```

Use an image model that is turned on. A chat model on this path is rejected.

## Video

```bash
curl http://127.0.0.1:8787/v1/videos/generations \
  -H "Authorization: Bearer sk-airoute-..." \
  -H "Content-Type: application/json" \
  -d "{\"model\":\"provider/video-model\",\"prompt\":\"A slow pan across a harbor\"}"
```

Use a video model that is turned on.

## Decisions

Decision models do not use chat completions. They use `POST /v1/systemone`. The body is a state plus questions. The full shape is in [Decisions](decisions.md).

## Errors you can act on

| What you see | What to do |
| --- | --- |
| Connection refused | Start WowRouter |
| 401 unauthorized | Send a current `sk-airoute-` key |
| Model not found, or not active | Turn the model on, and check the public id |
| Wrong endpoint, mentions `/v1/systemone` | This model is a decision model |
| Provider authentication error | Replace the key on that provider's page |
| Listen address must stay on this computer | Use `127.0.0.1`, `localhost`, or `::1` |

After a failed call, open **Activity** in the panel. The detail view shows the request the router sent, with secrets hidden.
