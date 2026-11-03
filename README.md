# WowRouter

WowRouter is a local AI router. It runs on your computer, keeps provider keys in a local database, and gives Cursor and other tools one OpenAI-compatible address.

The router listens only on this machine, at `http://127.0.0.1:8787`. Nothing in the app is written to be reached from another computer.

| What you open | Address |
| --- | --- |
| Web panel | `http://127.0.0.1:8787` |
| OpenAI-compatible API | `http://127.0.0.1:8787/v1` |

The panel is where you add provider keys, turn models on, and create the router key your tools will use. The API is what Cursor calls.

Longer guides for install, the panel, Cursor, the desktop app, the API, and development are in [docs](docs/README.md).

## Install

Node.js 20 or newer is required for the npm package.

```bash
npm install -g wowrouter
wowrouter
```

`npm install -g airoute` and the `airoute` command are the same program. The same version is also published as `@foisalislambd/wowrouter` and `@foisalislambd/airoute` on GitHub Packages.

Desktop builds are attached to each [GitHub release](https://github.com/foisalislambd/wowrouter/releases). Unzip the archive for your system and run `WowRouter` (`WowRouter.exe` on Windows). The panel folder in that archive is the page the app serves.

Docker uses the same panel and API. The host port stays on this computer:

```bash
docker run -d --name wowrouter \
  -p 127.0.0.1:8787:8787 \
  -v wowrouter:/data \
  foisalislambd/wowrouter:latest
```

The same image is also `foisalislambd/airoute`, `ghcr.io/foisalislambd/wowrouter`, and `ghcr.io/foisalislambd/airoute`. Details are in [docs/docker.md](docs/docker.md).

## First setup

1. Open the panel.
2. Go to **Providers**, open a provider, paste that provider's API key, and save it.
3. Turn on the models you want to call. A model that is off is not offered to clients.
4. Open **API keys** and create a router key. The secret is shown once and starts with `sk-airoute-`.
5. In Cursor, or any OpenAI client, set the base URL to `http://127.0.0.1:8787/v1` and the API key to that router key.

A public model id looks like `openai/gpt-4o-mini`: the provider slug, a slash, then the upstream model id. WowRouter rewrites that to the id the provider expects.

```bash
curl http://127.0.0.1:8787/v1/chat/completions \
  -H "Authorization: Bearer sk-airoute-..." \
  -H "Content-Type: application/json" \
  -d "{\"model\":\"openai/gpt-4o-mini\",\"messages\":[{\"role\":\"user\",\"content\":\"Hello\"}]}"
```

Chat calls need three things at once: a saved provider key, the model switched on, and a router key on the request. The panel itself does not ask for the router key, because it is only served on localhost.

Some providers ship with an empty model list. **Load models** on that provider's page fills the list from the provider. Loading replaces that provider's current model list.

## Panel

| Page | What it is for |
| --- | --- |
| Overview | Whether the router is up, and counts for providers, keys, and recent calls |
| Providers | Keys, base URLs, and which models are on |
| Fallback | A backup chat model when the first one fails. Fallbacks apply to OpenAI-style chat |
| API keys | Router keys for Cursor and other clients. The full secret is shown only when you create it |
| Playground | Try a chat, media, or decision call without leaving the panel |
| Activity | Each gateway call. Open one row to see the request and response |
| Usage | Calls grouped by model |
| Settings | Data folder, listen address, and, on Windows, start with Windows |

Closing the browser tab does not stop the router.

## npm commands

```bash
wowrouter                  # start in this terminal and open the panel
wowrouter --detach         # start in the background and open the panel
wowrouter --no-open        # start without opening a browser
wowrouter status
wowrouter stop
wowrouter --addr 127.0.0.1:8787
wowrouter --data /path/to/data
```

`airoute` accepts the same flags. If a router is already answering on that address, `wowrouter` prints the panel and base URL instead of starting a second copy. `wowrouter stop` asks the local server to shut down. A desktop build from before shutdown support has to be quit from its tray icon.

`--data` chooses the folder for the database. When you omit it, WowRouter uses its default folder, described below.

## Desktop app

On Windows the default launch starts a background agent and a window.

- Closing the window leaves the router running.
- The tray icon can open the window again, turn **Start with Windows** on or off, or quit the router.
- Opening the app a second time focuses the window that is already open.
- `WowRouter.exe --agent` starts the router and tray with no window. Windows login uses this when start-with-Windows is on.
- `WowRouter.exe --ui` opens only the window. If the agent is not running, it reports that WowRouter is not running.

The Windows setting is also a checkbox on the panel's Settings page. It is stored in the data folder and applied by the running agent.

Linux and macOS builds start the same local server. The tray there waits until you stop the process. Closing a browser tab does not stop it.

## API

Clients that speak the OpenAI HTTP API use the base URL above and a router key.

| Method and path | Use |
| --- | --- |
| `GET /health` | `{"service":"wowrouter","status":"ok"}` when this router is up |
| `GET /v1/models` | Models that are turned on |
| `POST /v1/chat/completions` | Chat, including streaming |
| `POST /v1/images/generations` | Image models |
| `POST /v1/videos/generations` | Video models |
| `POST /v1/systemone` | Decision models |

A decision model does not answer `POST /v1/chat/completions`. Call `POST /v1/systemone` with a router key, a `model`, a `state`, and a `questions` object. Question types are yes/no (`noul`), a choice among options, or a score. The playground accepts the same JSON, or plain text that becomes one yes/no question.

Providers whose decision API speaks System One are called directly. The Together Tev model is translated from one System One question into a short chat completion, and the chosen letter is mapped back. That path does not return a calibrated probability. Respan and Jared Palmer have no public base URL in the catalog; paste a System One base URL on the provider page before calling them.

## Data

Keys and logs stay in one folder:

| System | Folder |
| --- | --- |
| Windows | `%AppData%\airoute-router` |
| macOS | `~/Library/Application Support/airoute-router` |
| Linux | `$XDG_CONFIG_HOME/airoute-router`, or `~/.config/airoute-router` |

That folder holds `airoute.db`, `secret.key`, and, for the desktop app, `desktop.json`. Provider keys are encrypted with the local secret. Router keys are stored as hashes; the panel cannot show a router key again after you leave the create screen. The desktop app also writes `agent.log` there.

Deleting the folder removes keys, logs, and settings. Keep a copy of `secret.key` with the database if you move the folder. One without the other cannot decrypt provider keys.

The server rejects a listen address that is not a loopback address (`127.0.0.1`, `localhost`, or `::1`).

## Develop

Go 1.26 or newer and Node.js 20 or newer.

```bash
npm install
npm run dev:server
npm run dev:panel
```

The Vite panel runs at `http://127.0.0.1:5173` and talks to the Go server on port 8787. For a production panel served by Go itself:

```bash
npm run build:panel
npm run dev:desktop
```

`npm run build:npm` builds the panel and the server binaries that the npm package ships, into `packages/cli`. Those build outputs are not committed.

| Path | Role |
| --- | --- |
| `apps/server` | Go router, SQLite, and the HTTP API |
| `apps/panel` | React panel |
| `apps/desktop` | Native window and background agent |
| `packages/cli` | npm package that launches the server and opens the panel |
| `packages/sse` | Parser for OpenAI server-sent chat streams |

The version in the root `package.json` is the release version. Pushing `main` with a higher version builds the desktop archives, publishes `wowrouter` and `airoute` to npm, publishes `@foisalislambd/wowrouter` and `@foisalislambd/airoute` to GitHub Packages, pushes the Docker image under both names, and creates the GitHub release. A commit message that contains `skip release` skips that.

## Contributing

Issues and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before you start. Report vulnerabilities in private, as described in [SECURITY.md](SECURITY.md).

## License

WowRouter is [MIT](LICENSE) licensed. Copyright 2026 foisalislambd.
