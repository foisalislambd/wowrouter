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
| Fill first | The first enabled account that is not cooling down is used. A 429, 401, or 403 cools that account before the next call. |
| Priority | Same as fill first. Account order on the page is the priority. |
| Round robin | Calls spread across the enabled accounts that are not cooling down. |
| Random | Each call picks a live account. |

The strategy is read on every call. Saving it and leaving the gateway on round robin was a bug; that is fixed. A cooldown from a 429, 401, or 403 is written to the local database and applied again after a restart.

Anthropic rate-limit headers (`anthropic-ratelimit-*-remaining`) update the quota the combo scorer sees.

## Subscription login

Subscription sign-in is on the Providers page. `POST /oauth/{provider}/start` (console session required) begins PKCE, a device code, or Cursor's deep-control login. Device-code providers are `github-copilot`, `gemini`, and `kiro`. PKCE providers are `claude`, `codex`, `github`, `antigravity`, and `cline`. `POST /oauth/{provider}/poll` finishes a device or Cursor login. Client ids that are not public defaults come from `WOWROUTER_OAUTH_GEMINI_CLIENT_ID`, `WOWROUTER_OAUTH_ANTIGRAVITY_CLIENT_ID`, `WOWROUTER_OAUTH_ANTIGRAVITY_CLIENT_SECRET`, and `WOWROUTER_OAUTH_CLINE_CLIENT_ID`. The refresh token stays in the encrypted provider record. When it is within a minute of expiry, the next call refreshes it and stores the new access token.

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

Some providers are listed but marked unsupported. Those rows are there so you can see them. They do not complete a chat call.

## Fallback

**Fallback** is a named chain of chat models. The public id looks like `fallback/your-name`. If the first model fails, WowRouter tries the next.

Every step in a fallback has to be an OpenAI-style chat model. Image, video, and decision models cannot sit in the chain. The panel will say so if you add one.

Create the chain on the Fallback page, turn it on the same way you think about any other model, and pass `fallback/your-name` as the model id from the client.
