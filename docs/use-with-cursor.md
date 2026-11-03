# Use with Cursor

Cursor talks to WowRouter the same way it talks to OpenAI. You change two settings. The models themselves still come from the providers you turned on in the panel.

## Before you open Cursor

1. WowRouter is running. `http://127.0.0.1:8787/health` shows `"service": "wowrouter"`.
2. The provider key is saved and the model is on. Confirm that in the [panel](panel.md).
3. You have a router key from **API keys**. It starts with `sk-airoute-`.

## Settings in Cursor

| Setting | Value |
| --- | --- |
| Base URL | `http://127.0.0.1:8787/v1` |
| API key | the `sk-airoute-` key from the panel |
| Model | a public id such as `openai/gpt-4o-mini` |

The base URL includes `/v1`. Cursor adds `/chat/completions` itself. If you paste only `http://127.0.0.1:8787`, chat calls miss the router.

Use the provider's key only inside the WowRouter panel. Cursor should hold the router key, not the OpenAI or Anthropic key.

## Model ids

A model id is `provider/model`.

| You want | Model id to type |
| --- | --- |
| OpenAI's GPT-4o mini | `openai/gpt-4o-mini` |
| A model from another provider | that provider's slug, a slash, then the upstream id shown in the panel |

The slug is the name in the provider's address, such as `/providers/openai`. The panel shows the upstream id on the model row.

## Other OpenAI apps

Any app that asks for an OpenAI base URL and an API key can use the same pair:

```text
http://127.0.0.1:8787/v1
sk-airoute-...
```

A small check from a terminal:

```bash
curl http://127.0.0.1:8787/v1/chat/completions \
  -H "Authorization: Bearer sk-airoute-..." \
  -H "Content-Type: application/json" \
  -d "{\"model\":\"openai/gpt-4o-mini\",\"messages\":[{\"role\":\"user\",\"content\":\"Hello\"}]}"
```

Replace the key and the model with ones you have turned on.

## What Cursor cannot call this way

Cursor sends chat completions. Decision models answer `POST /v1/systemone` instead. If you pick one in a chat box, the router tells you to use that other path. [Decisions](decisions.md) explains it.

Image and video models use their own paths too. Those are listed in the [API](api.md) guide.

## When Cursor says the request failed

- Connection refused: WowRouter is stopped. Start it with `wowrouter` or the desktop app.
- Unauthorized: the router key is missing, wrong, or deleted. Create a new one on **API keys**.
- Model not found: the id is wrong, or that model is off.
- Provider error: the provider rejected its own key. Open the provider page and test the connection.
