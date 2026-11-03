# Panel

The panel is the web page at `http://127.0.0.1:8787`. You use it to manage providers, models, and the key your tools send. It does not ask you to log in until you turn on a password or OIDC in **Settings**.

## Pages

| Page | What you do there |
| --- | --- |
| Overview | See that the router is up, and how many keys and calls you have |
| Providers | Save a provider key, set a base URL, and turn models on |
| Routing | Use `auto`, or save a combo that tries the next model when one fails |
| Clients | Copy a sample config, or write Claude Code, OpenCode, and Codex config on this computer after you confirm |
| API keys | Create the key Cursor will use. A monthly dollar cap is optional |
| Playground | Try a prompt, an image, or a decision before you wire up a tool |
| Activity | Read one call at a time, including the request that was sent |
| Usage | See calls grouped by model |
| Memory | Notes that chat calls can include when memory is on |
| Models, Quota, Endpoints | Search the catalog, read saved rate limits, and copy the local routes |
| Costs, Health, Audit | Spend, process health, and MCP or A2A call history |
| Webhooks, Batches, Limits, Cache, Compression | Outbound hooks, batch files, a per-minute cap, the response cache, and local prompt rewrites |
| Agents, Skills, Evals, Services | Cloud-agent notes, saved instructions, prompt checks, and bookmarks |
| Settings | Data folder, listen address, optional password or OIDC, sidebar visibility, and the cache, compression, and memory toggles. On Windows, start with Windows |

## A normal first visit

1. Open **Providers**.
2. Open the provider you have an account with, such as OpenAI.
3. Paste that provider's own API key and save it.
4. Turn on one model. A model that is off will not show up for Cursor.
5. Open **API keys** and create a key. Copy it now. It starts with `sk-airoute-` and the panel will not show the full secret again.
6. Open **Playground**, pick that model, and send a short prompt.

If the playground replies, Cursor can use the same model. The [Cursor guide](use-with-cursor.md) is the next step.

## Load models

Many OpenAI-compatible providers start with an empty list. **Load models** asks that provider for its current list and saves it. Providers with a fixed catalog, including the device-login and session-token ones, do not show that button.

GitHub Enterprise Copilot uses **Sign in with GitHub**. Save the enterprise base URL, enter the OAuth app client id you created, and finish the device code in the browser. Copilot Web asks you to paste only the bearer token from a signed-in request. The page labels that flow unofficial.

Loading replaces the list already stored for that provider. Use it when the page is empty. If the provider already shows the models you want, you can leave the list as it is.

## Playground

The playground calls the local router. It does not need the `sk-airoute-` key, because you are already on the panel.

- Chat and media use the model you pick and the text you type.
- A decision model expects a state and questions. You can type plain text, which becomes one yes/no question, or paste JSON. See [Decisions](decisions.md).

The answer appears in the page. **Activity** keeps a copy of the call.

## Activity and usage

**Activity** is the log. The list shows recent calls. Open one row when you want the request and the response. Clearing activity deletes those rows. It does not delete provider keys.

**Usage** groups the same log by model and shows the last 14 days. Cost is an estimate from the catalog price stored for that model. A model with a zero price stays at $0.

## Routing

**Auto** needs no combo. Set the model to `auto`, `auto/cheap`, `auto/fast`, or `auto/coding`. WowRouter ranks chat models that are turned on and tries up to four of them.

A **combo** is a named list. Its id is `fallback/the-name`. The order can be priority, round robin, weighted, cheapest, or least used. If the first try fails, the next model in that order runs.

## Panel password

The password is off when you install WowRouter. The panel and `GET /health` stay open, and `/v1` still requires a router key.

Turn the password on from **Settings** when the process can be reached from outside this computer. The password is stored as a bcrypt hash. A signed-in browser gets an HttpOnly session cookie that lasts 14 days. Wrong passwords are throttled. Changing the password signs other browsers out. Turning it off deletes the hash and the sessions, and the panel is open again.

The router key your tools send is not this password.

OIDC is a second optional lock. Leave it off unless you want the panel to send you to an identity provider. The redirect URL is shown in Settings. An issuer must be `https`, except `http` on localhost. The client secret is encrypted with the same local key as provider secrets. If either the password or OIDC is on, the panel asks you to sign in. If neither is on, it stays open.

Prompt compression, the response cache, and memory are also in Settings and start off. Memory notes live on the Memory page.

## What this router does not intercept

WowRouter does not install a certificate authority or intercept TLS. Point a client at the router on purpose. Capturing traffic from programs that were not aimed at WowRouter is out of scope.

## If a call fails in the playground

Read the message on the page, then open the call in **Activity**.

- The provider key is missing or rejected: open that provider and save the key again.
- The model is off: turn it on.
- The model is a decision model: use a decision prompt, or call `POST /v1/systemone` from a script. Chat will tell you to do that.
- The provider has no base URL: paste one on the provider page. Some decision providers need this.

Keys and logs are stored on disk. [Your data](your-data.md) explains the folder.
