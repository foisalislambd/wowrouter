# WowRouter

WowRouter is a local AI router. It runs on your computer, keeps provider keys in a local database, and gives Cursor and other tools one OpenAI-compatible address.

The router listens only on this machine, at `http://127.0.0.1:8787`. Nothing in the app is written to be reached from another computer.

| What you open | Address |
| --- | --- |
| Web panel | `http://127.0.0.1:8787/` |
| OpenAI-compatible API | `http://127.0.0.1:8787/v1` |

The panel is where you add provider keys, turn models on, and create the router key your tools will use. The API is what Cursor calls.

Longer guides for install, the panel, Cursor, the desktop app, the API, and development are in [docs](docs/README.md). The local benchmark is in [Benchmark](#benchmark).

## Install

Node.js 20 or newer is required for the npm package.

```bash
npm install -g wowrouter
wowrouter
```

`npm install -g airoute` and the `airoute` command are the same program. The same version is also published as `@foisalislambd/wowrouter` and `@foisalislambd/airoute` on GitHub Packages.

Desktop builds are attached to each [GitHub release](https://github.com/foisalislambd/wowrouter/releases). Unzip the archive for your system and run `WowRouter` (`WowRouter.exe` on Windows). The panel folder in that archive is the page the app serves. The first start prints an admin token and writes `bootstrap-token` in the data folder. Sign in with that token. Router keys you create start with `sk-wowrouter-`.

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
4. Open **API keys** and create a router key. The secret is shown once and starts with `sk-wowrouter-`.
5. In Cursor, or any OpenAI client, set the base URL to `http://127.0.0.1:8787/v1` and the API key to that router key.

A public model id looks like `openai/gpt-4o-mini`: the provider slug, a slash, then the upstream model id. WowRouter rewrites that to the id the provider expects.

```bash
curl http://127.0.0.1:8787/v1/chat/completions \
  -H "Authorization: Bearer sk-wowrouter-..." \
  -H "Content-Type: application/json" \
  -d "{\"model\":\"openai/gpt-4o-mini\",\"messages\":[{\"role\":\"user\",\"content\":\"Hello\"}]}"
```

Chat calls need three things at once: a saved provider key, the model switched on, and a router key on the request. The panel asks for the admin token before it shows those pages.

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

## Gateway console

The panel is the whole admin UI: providers, virtual models, routing, guardrails, budgets, keys, and the request log. `/ui` redirects to `/`. Details are in [docs/gateway/getting-started.md](docs/gateway/getting-started.md).

## Benchmark

On one machine, WowRouter, a minimal loopback proxy, and a direct connection to the same mock each took a small OpenAI chat request. The mock answers immediately, so the wait past the direct run is the target's own time. The response cache was off. The loopback proxy only forwards bytes. It is a baseline that lives in this harness.

The same harness can also start the gateways that install on this machine: Antirion 0.1.1, Bifrost 2.4.0, LiteLLM 1.106.6, OmniRoute 3.8.52, Portkey gateway 1.15.2, and Helicone AI Gateway 0.2.0-beta.30. WowRouter is one gateway. The model `chat` target is that same gateway configured through the admin API, not a second router. Kong AI Gateway, Envoy AI Gateway, and TensorZero were not started: no Docker, and TensorZero's latest release publishes no gateway binary.

The generator, the mock, and the gateway shared 4 CPUs. That is not Antirion's published layout, which uses a dedicated machine for each role and longer windows. The method and every cell are in [docs/benchmarks.md](docs/benchmarks.md). Numbers below are the medians from the unified-gateway run in `bench/results/published/` (`2026-11-01`, version 1.1.8). The peer-gateway table from the earlier run is in that document, under Peer gateways, and in `bench/results/comparison/`.

**Simple chat at 500 requests per second.** Overhead is that repetition's latency minus its own direct run. A dash means the cell had no successful samples to score.

| | WowRouter | Loopback proxy | Direct |
| --- | ---: | ---: | ---: |
| Overhead p50 | 269 µs | 102 µs | — |
| Overhead p99 | 469 µs | 114 µs | — |
| Latency p50 | 1.04 ms | 850 µs | 762 µs |
| Latency p99 | 1.87 ms | 1.60 ms | 1.41 ms |
| Success | 100% | 100% | 100% |
| CPU per request | 596 µs | 228 µs | — |
| Peak memory | 22.7 MiB | 13.8 MiB | — |
| Idle memory | 13.8 MiB | 8.1 MiB | — |

The peer-gateway run is in [docs/benchmarks.md](docs/benchmarks.md#peer-gateways). On that earlier binary, Antirion's overhead p50 was 254 µs, Bifrost 423 µs, Helicone 369 µs, and Portkey 831 µs. LiteLLM was 52.69 ms. OmniRoute finished none of the 2,500 requests inside 8 seconds. LiteLLM's CPU cell is blank because the harness read 0 µs from the process it sampled while the workers were serving.


| Scenario | WowRouter | Loopback proxy | Direct |
| --- | --- | --- | --- |
| 64 connections | 6,744 req/s, p50 7.97 ms | 19,816 req/s, p50 3.10 ms | 55,455 req/s, p50 809 µs |
| Highest open-loop rate with p99 overhead ≤ 5ms | 2,000 req/s | — | — |
| 1,000 req/s, overhead p50 / p99 | 338 µs / 641 µs | — | p50 635 µs |
| 5,000 req/s | p50 2.28 ms, 100% finished, overhead p99 13.88 ms | — | p50 572 µs, 100% |
| Unknown key at 2,000 req/s, p50 / p99 | 587 µs / 1.37 ms | — | — |
| Unknown model at 2,000 req/s, p50 / p99 | 718 µs / 2.12 ms | — | — |
| Streaming at 200 req/s, time-to-first-byte overhead p50 / p99 | 336 µs / 523 µs | — | — |

At 5,000 requests/s every request finished. p99 overhead rose to 13.88 ms, so the saturation ladder stops at 2,000 requests/s. The closed loop at 64 connections kept the gateway near two cores. A later run of that cell, after the activity-log queue was capped, peaked at 30.7 MiB and still finished about 6,200–7,500 requests/s. Streaming time-to-first-byte overhead was p50 336 µs.

**How it is measured.** Open loop, latency from the scheduled send time, three repetitions, median of each metric. The upstream is a local mock with no added delay. [docs/benchmarks.md](docs/benchmarks.md) has the cells, the pass rule for the saturation ladder, and the machine. **Reproduce it** on Linux with Go 1.26 or newer. Peer binaries are installed by `./bench/setup-targets.sh` into `bench/.cache` (not committed). Then:

```bash
./bench/run.sh -out bench/results/published
```

`npm run bench` is the same harness without `-out`. A new run writes `bench/results/<timestamp>/` and will not match these numbers on another machine.

## Data

Keys and logs stay in one folder:

| System | Folder |
| --- | --- |
| Windows | `%AppData%\wowrouter` |
| macOS | `~/Library/Application Support/wowrouter` |
| Linux | `$XDG_CONFIG_HOME/wowrouter`, or `~/.config/wowrouter` |

That folder holds `wowrouter.db`, `secret.key`, `bootstrap-token`, and, for the desktop app, `desktop.json`. On first start, WowRouter also reads an older `airoute-router` folder and imports providers, provider keys, models, fallbacks, settings, and recent history. It does not import old router keys. Create new `sk-wowrouter-` keys. The old files are kept. Provider keys are encrypted with the local secret. Router keys are stored as hashes; the panel cannot show a router key again after you leave the create screen. The desktop app also writes `agent.log` there.

Deleting the folder removes keys, logs, and settings. Keep a copy of `secret.key` with the database if you move the folder. One without the other cannot decrypt provider keys.

The server rejects a listen address that is not a loopback address (`127.0.0.1`, `localhost`, or `::1`).

## Develop

Go 1.26 or newer and Node.js 20 or newer.

```bash
npm install
npm run build:panel
npm run dev:server
npm run dev:panel
```

The Vite panel runs at `http://127.0.0.1:5173` and talks to the Go server on port 8787. `npm run build:panel` writes the folder the server, desktop app, npm package, and Docker image serve.

`npm run build:npm` builds the panel and the server binaries that the npm package ships, into `packages/cli`. Those build outputs are not committed.

| Path | Role |
| --- | --- |
| `apps/server` | Go router, SQLite, and the HTTP API |
| `apps/panel` | Vite panel, the only web UI |
| `apps/desktop` | Native window and background agent |
| `packages/cli` | npm package that launches the server and opens the panel |
| `packages/sse` | Parser for OpenAI server-sent chat streams |

The version in the root `package.json` is the release version. Pushing `main` with a higher version builds the desktop archives, publishes `wowrouter` and `airoute` to npm, publishes `@foisalislambd/wowrouter` and `@foisalislambd/airoute` to GitHub Packages, pushes the Docker image under both names, and creates the GitHub release. A commit message that contains `skip release` skips that.

## Contributing

Issues and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before you start. Report vulnerabilities in private, as described in [SECURITY.md](SECURITY.md).

## License

WowRouter's own code is [MIT](LICENSE) licensed. Copyright 2026 foisalislambd.

The web panel and parts of the gateway are derived from [Antirion](https://github.com/eliasbiondo/antirion), Copyright 2026 Elias Biondo, and are licensed under Apache-2.0. Those portions were modified. See [NOTICE](NOTICE) and [LICENSES/Apache-2.0.txt](LICENSES/Apache-2.0.txt). The bundled model directory is from [models.dev](https://models.dev) under the MIT License.
