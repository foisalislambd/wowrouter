# API

The API is OpenAI-shaped and local. Every call below uses:

```text
http://127.0.0.1:8787
Authorization: Bearer sk-wowrouter-...
```

Create the bearer key in the panel under **API keys**. Provider keys stay in the panel. Do not send those to this API.

`GET /health` is the exception. It needs no key. It answers `{"service":"wowrouter","status":"ok"}`.

## List models

```bash
curl http://127.0.0.1:8787/v1/models \
  -H "Authorization: Bearer sk-wowrouter-..."
```

You only see models that are turned on. A missing model in this list means it is off, or the provider has no list yet. See [Providers and models](providers-and-models.md).

## Chat

```bash
curl http://127.0.0.1:8787/v1/chat/completions \
  -H "Authorization: Bearer sk-wowrouter-..." \
  -H "Content-Type: application/json" \
  -d "{\"model\":\"openai/gpt-4o-mini\",\"messages\":[{\"role\":\"user\",\"content\":\"Hello\"}]}"
```

Streaming works the same way as OpenAI: set `"stream": true`. Tools, tool results, and `cache_control` on content blocks are translated for Anthropic and Gemini providers. OpenAI-compatible providers receive the body unchanged.

## Responses

Codex and other Responses clients use `POST /v1/responses`. The body uses `input` and `instructions`. The router turns that into a chat request and returns a Responses object, including streamed `response.output_text.delta` events. A chat call may send `Idempotency-Key`. The same key returns the stored response for five minutes, including after a restart, for bodies up to 1 MiB.

```bash
curl http://127.0.0.1:8787/v1/responses \
  -H "Authorization: Bearer sk-wowrouter-..." \
  -H "Content-Type: application/json" \
  -d "{\"model\":\"openai/gpt-4o-mini\",\"input\":\"Hello\"}"
```

A repeated chat call can send `Idempotency-Key`. The same key within five minutes returns the first response.

## Embeddings, audio, moderations, search, batches

`POST /v1/embeddings`, `POST /v1/audio/speech`, `POST /v1/audio/transcriptions`, `POST /v1/audio/translations`, and `POST /v1/moderations` forward to the provider selected by `model`.

`POST /v1/search` takes `query` and `model` and runs one chat turn.

`POST /v1/batches` accepts `{ "requests": [ { "custom_id": "1", "model": "openai/gpt-4o-mini", "messages": [...] } ] }` and runs each line before answering. `GET /v1/batches/{id}` returns that result.

The model id must include the provider slug. `gpt-4o-mini` alone is not enough. Use `openai/gpt-4o-mini`.

A fallback id such as `fallback/writing` is valid here when you created that chain in the panel.

## Images

```bash
curl http://127.0.0.1:8787/v1/images/generations \
  -H "Authorization: Bearer sk-wowrouter-..." \
  -H "Content-Type: application/json" \
  -d "{\"model\":\"provider/image-model\",\"prompt\":\"A small red boat\"}"
```

Use an image model that is turned on. A chat model on this path is rejected.

## Video

```bash
curl http://127.0.0.1:8787/v1/videos/generations \
  -H "Authorization: Bearer sk-wowrouter-..." \
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
| 401 unauthorized | Send a current `sk-wowrouter-` key |
| Model not found, or not active | Turn the model on, and check the public id |
| Wrong endpoint, mentions `/v1/systemone` | This model is a decision model |
| Provider authentication error | Replace the key on that provider's page |
| Listen address must stay on this computer | Use `127.0.0.1`, `localhost`, or `::1` |

After a failed call, open **Activity** in the panel. The detail view shows the request the router sent, with secrets hidden.
