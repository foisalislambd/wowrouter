# Providers and models

A provider is an account you already have: OpenAI, Anthropic, a gateway, a local server, and so on. A model is one entry under that provider. WowRouter does not sell model access. It forwards a call after you save the provider's key and turn the model on.

## Turn a model on

1. Open **Providers** in the panel.
2. Open the provider.
3. Save its API key. Use **Test** when the page offers it.
4. Turn the model on.

Until those steps are done, a client that asks for the model gets an error.

## More than one account

A provider can hold several accounts. On the provider page, add each key or session cookie under **Accounts**, then turn the ones you want on.

**Account order** decides which one is called first:

| Order | What happens |
| --- | --- |
| Fill first | The lowest priority number is used until that call fails. The next enabled account is tried in the same request. |
| Round robin | Calls spread across the enabled accounts. The one used least recently goes first. |

Priority `0` is first in fill-first order. A new account is added after the ones you already have. If the provider is on and it needs a key, the last remaining account cannot be removed until you turn the provider off.

## Model ids

Clients always use a public id:

```text
provider-slug/upstream-id
```

Examples:

| Public id | Meaning |
| --- | --- |
| `openai/gpt-4o-mini` | OpenAI's GPT-4o mini |
| `anthropic/claude-...` | that Claude model, if it is in the catalog and turned on |

The slug is the last part of the provider page address, `/providers/openai`. The upstream id is the name the provider itself uses. The panel shows both. WowRouter strips the slug before it calls the provider.

## Empty lists

A lot of OpenAI-compatible providers ship with no models until you press **Load models**. That button downloads the provider's list and stores it.

Load models replaces the list for that provider. If you already curated which models are on, loading again starts from the provider's list.

## Base URL

Most providers have a base URL in the catalog. A few do not, because there is no single public host to assume. The provider page leaves the field empty. Paste the base URL from that provider's own docs, then save.

A wrong base URL shows up as a connection error in **Activity**.

## Kinds of model

| Kind | How you call it |
| --- | --- |
| Chat | `POST /v1/chat/completions`, or Cursor |
| Image | `POST /v1/images/generations` |
| Video | `POST /v1/videos/generations` |
| Decision | `POST /v1/systemone`, not chat |

Chat is the path Cursor uses. The other kinds are in the [API](api.md) and [Decisions](decisions.md) guides. If you send a decision model to chat, the router tells you to use `POST /v1/systemone`.

## Protocols that are not plain OpenAI chat

These providers answer `POST /v1/chat/completions`. The router translates the call.

| Provider | What you save | What a chat call does |
| --- | --- | --- |
| Inflection, Clarifai, Eden AI, PiAPI, Kong AI Gateway, Inceptron, Codex Cloud | API key, and a base URL when the catalog leaves it blank | OpenAI-compatible chat, including tools and streaming |
| GitLab Duo | Personal access token. Self-managed instances use `https://gitlab.example.com/api/v4` | Official code-suggestions API |
| Amazon Bedrock | `accessKeyId:secretAccessKey`, plus `:sessionToken` for temporary credentials | SigV4-signed call to the Bedrock OpenAI runtime. The default region is `us-east-1` |
| SAP AI Core | The service key JSON, and the deployment chat URL | Client-credentials token, then the deployment |
| Naver CLOVA Studio | API key | Official v3 chat-completions |
| Jules, Devin | API key | Creates a cloud coding session and returns its URL or id |
| ComfyUI | Nothing. The default base URL is `http://127.0.0.1:8188` | Queues a workflow. A JSON message is the graph. Plain text queues a one-node prompt |
| DuckDuckGo AI Chat | Nothing | Unofficial anonymous chat. DuckDuckGo can change or block it |
| GitHub Enterprise Copilot | Your own OAuth app client id, then **Sign in with GitHub** | Device flow. The access token is encrypted locally and refreshed when the server sent a refresh token |
| Microsoft Copilot Web | Only the bearer token from a signed-in `copilot.microsoft.com` request | Unofficial. Do not paste the Cookie header |

The provider page says **Unofficial / experimental** when the contract is not a published API.

## Still unsupported

The rest of the old unsupported list stays unsupported. A pasted cookie or a scraped login does not make them reliable.

- Website tools (SharedChat, FlowGPT, Perchance, Pika, and the other site-only rows) have no public chat API.
- Web-cookie sites other than Copilot Web (Arena, Poe, v0, Notion, Firefly, and similar) depend on a browser, a captcha, or a private websocket.
- OAuth rows other than GitHub Enterprise Copilot (xAI, Kiro, Amazon Q, Cursor, Zed, Kimi, and similar) do not publish a third-party client. Kiro's terms also forbid a third-party proxy. PKCE helpers exist in the server for a future public client, and no provider ships a client id.
- Local CLI bridges (Auggie, Zcode, Codex app server, Devin's local agent) speak a private protocol owned by that binary.
- Cloudflare Playground needs a browser. Chipotle's endpoint is a support-chat socket. Puter is a client SDK. OpenInference and Perceptron are tracing and middleware, not chat.

Those rows stay in the list with the badge **Unsupported**. Chat returns an error instead of pretending the call succeeded.

## Routing

`auto` is ready as soon as at least one chat model is turned on. Variants:

| Model id | What it prefers |
| --- | --- |
| `auto` | A balance of catalog price, recent latency, errors, and context |
| `auto/coding` | Reasoning models and a longer context |
| `auto/fast` | Models that have recently answered quickly |
| `auto/cheap` | The lowest catalog price |

WowRouter tries up to four. If one fails, the next ranked model is called in the same request.

A combo is a list you name on the Routing page. The public id looks like `fallback/your-name`. The order is one of priority, round robin, weighted, cheapest, or least used. If the chosen model fails, the next one in that order runs.

Every step has to be a chat model the router can call. Image, video, and decision models cannot sit in the chain. The panel will say so if you add one.
