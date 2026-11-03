# Panel

The panel is the web page at `http://127.0.0.1:8787`. You use it to manage providers, models, and the key your tools send. The page does not ask you to log in. It is only available on this computer.

## Pages

| Page | What you do there |
| --- | --- |
| Overview | See that the router is up, and how many keys and calls you have |
| Providers | Save a provider key, set a base URL, and turn models on |
| Fallback | Choose a backup chat model if the first one fails |
| API keys | Create the key Cursor will use |
| Playground | Try a prompt, an image, or a decision before you wire up a tool |
| Activity | Read one call at a time, including the request that was sent |
| Usage | See calls grouped by model |
| Settings | See the data folder and the listen address. On Windows, start with Windows |

## A normal first visit

1. Open **Providers**.
2. Open the provider you have an account with, such as OpenAI.
3. Paste that provider's own API key and save it.
4. Turn on one model. A model that is off will not show up for Cursor.
5. Open **API keys** and create a key. Copy it now. It starts with `sk-airoute-` and the panel will not show the full secret again.
6. Open **Playground**, pick that model, and send a short prompt.

If the playground replies, Cursor can use the same model. The [Cursor guide](use-with-cursor.md) is the next step.

## Load models

Many providers start with an empty list. **Load models** asks that provider for its current list and saves it.

Loading replaces the list already stored for that provider. Use it when the page is empty. If the provider already shows the models you want, you can leave the list as it is.

## Playground

The playground calls the local router. It does not need the `sk-airoute-` key, because you are already on the panel.

- Chat and media use the model you pick and the text you type.
- A decision model expects a state and questions. You can type plain text, which becomes one yes/no question, or paste JSON. See [Decisions](decisions.md).

The answer appears in the page. **Activity** keeps a copy of the call.

## Activity and usage

**Activity** is the log. The list shows recent calls. Open one row when you want the request and the response. Clearing activity deletes those rows. It does not delete provider keys.

**Usage** groups the same log by model so you can see what you have been calling.

## If a call fails in the playground

Read the message on the page, then open the call in **Activity**.

- The provider key is missing or rejected: open that provider and save the key again.
- The model is off: turn it on.
- The model is a decision model: use a decision prompt, or call `POST /v1/systemone` from a script. Chat will tell you to do that.
- The provider has no base URL: paste one on the provider page. Some decision providers need this.

Keys and logs are stored on disk. [Your data](your-data.md) explains the folder.
