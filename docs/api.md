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

You only see models that are turned on. A missing model in this list means it is off, or the provider has no list yet. See [Providers and models](providers-and-models.md).

## Chat

```bash
curl http://127.0.0.1:8787/v1/chat/completions \
  -H "Authorization: Bearer sk-airoute-..." \
  -H "Content-Type: application/json" \
  -d "{\"model\":\"openai/gpt-4o-mini\",\"messages\":[{\"role\":\"user\",\"content\":\"Hello\"}]}"
```

Streaming works the same way as OpenAI: set `"stream": true`. Tools and the usual chat fields are forwarded to providers that speak the OpenAI chat API.

The model id must include the provider slug. `gpt-4o-mini` alone is not enough. Use `openai/gpt-4o-mini`.

A fallback id such as `fallback/writing` is valid here when you created that chain in the panel.

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
