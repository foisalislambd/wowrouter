# WowRouter

WowRouter is a local AI router. It runs on your computer, keeps provider keys in a local database, and gives Cursor and other tools one OpenAI-compatible address.

The router listens only on this machine, at `http://127.0.0.1:8787`. Nothing in the app is written to be reached from another computer.

| What you open | Address |
| --- | --- |
| Web panel | `http://127.0.0.1:8787` |
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

## Gateway console

The same process serves an admin console at `http://127.0.0.1:8787/ui/`. It is the gateway UI: providers, virtual models, routing, guardrails, budgets, keys, and the request log. Build it once from `apps/console` (`pnpm install` and `pnpm build`), then start the server from the repo root. The first start writes an admin token to `bootstrap-token` in the data directory. Sign in at `/ui/login/`. Virtual model names have no slash (`chat`). Names like `openai/gpt-4o-mini` stay on the existing router. Details are in [docs/gateway/getting-started.md](docs/gateway/getting-started.md).

## Benchmark

WowRouter was measured on one shared machine against the same instant mock as a loopback proxy in this harness, a direct connection, and the gateways that could actually be installed here: Antirion 0.1.1, Bifrost 2.4.0, LiteLLM 1.106.6, OmniRoute 3.8.52, Portkey gateway 1.15.2, and Helicone AI Gateway 0.2.0-beta.30. Both WowRouter paths are in the table. Classic is `openai/gpt-4o-mini`. Virtual is the model name `chat`, with the response cache off. The activity log stays on for both, because there is no switch to turn it off.

This is not Antirion's published layout. The generator, the mock, and the gateway shared 4 CPUs. Antirion's own write-up uses a dedicated machine for each role and longer windows. Kong AI Gateway, Envoy AI Gateway, and TensorZero were not started: no Docker, and TensorZero's latest release publishes no gateway binary. The method, the machine, and every cell are in [docs/benchmarks.md](docs/benchmarks.md). Numbers below are medians from the run in `bench/results/published/` (commit `35fdf61`, 2026-11-01 13:55Z–15:10Z).

**Simple chat at 500 requests per second.** Overhead is that repetition's latency minus its own direct run. A dash means the cell had no successful samples to score. OmniRoute finished 0 of 2,500 requests inside the generator's 8s cap.

| Gateway | Overhead p50 | Overhead p99 | Latency p50 | CPU / request | Peak RSS | Idle RSS | 64-conn req/s | Highest sustained | Unknown key p50 | Errors at 500 rps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| WowRouter classic | 673 µs | 1.30 ms | 1.42 ms | 632 µs | 26.4 MiB | 24.2 MiB | 1,901 | 1,000 rps | 605 µs | 0 |
| WowRouter virtual | 1.09 ms | 2.06 ms | 1.83 ms | 856 µs | 29.4 MiB | 23.9 MiB | 1,512 | 1,000 rps | 607 µs | 0 |
| Loopback proxy | 65 µs | 207 µs | 852 µs | 224 µs | 14.1 MiB | 8.1 MiB | 19,187 | 8,000 rps | — | 0 |
| Antirion | 254 µs | 400 µs | 1.02 ms | 292 µs | 129.4 MiB | 118.1 MiB | 18,818 | 8,000 rps | 617 µs | 0 |
| Bifrost | 423 µs | 532 µs | 1.18 ms | 764 µs | 345.1 MiB | 271.3 MiB | 7,381 | 100 rps | 748 µs | 0 |
| LiteLLM | 52.69 ms | 311.26 ms | 53.44 ms | — | 294.6 MiB | 294.8 MiB | 598 | none | 1.18 s | 0 |
| OmniRoute | — | — | — | 468 µs | 139.3 MiB | 130.0 MiB | 0 | none | 2.49 s | 2,500 |
| Portkey | 831 µs | 2.41 ms | 1.59 ms | 1,240 µs | 179.2 MiB | 94.9 MiB | 2,834 | 250 rps | — | 0 |
| Helicone | 369 µs | 652 µs | 1.08 ms | 384 µs | 46.7 MiB | 42.4 MiB | 16,872 | 8,000 rps | — | 0 |
| Direct | — | — | 748 µs | — | — | — | 62,724 | — | — | 0 |

LiteLLM's CPU cell is blank on purpose. The harness read 0 µs from the process it sampled while the workers were serving, so that counter is not a result. Portkey and Helicone have no stored client key in these builds, so they were not given an unknown-key cell. OmniRoute forwards an unknown model to the provider. Bifrost answers an unknown model with 403, at p50 768 µs. WowRouter classic answers one with 404 at p50 1.02 ms. The virtual path also answers 404, but at 2,000 requests/s that p50 was 2.05 s because the requests queued.

At 5,000 requests/s the median WowRouter classic repetition still finished all 15,000 requests, at p50 5.55 s. One of the three repetitions finished 14,238. Antirion and Helicone stayed under 1 ms p50 and finished every request. The direct run at that rate was p50 577 µs.

Streaming at 200 requests/s is in the full report. Classic WowRouter's time-to-first-byte overhead was p50 430 µs. The virtual path returned 200 with a body that was not an SSE stream ending in `[DONE]`, so that cell was not scored. Portkey returned 500. Helicone returned 200 that was not the expected stream body.

**Reproduce it** on Linux with Go 1.26 or newer. Peer binaries are installed by `./bench/setup-targets.sh` into `bench/.cache` (not committed). Then:

```bash
./bench/run.sh -out bench/results/published
```

`npm run bench` is the same harness without `-out`. A new run writes `bench/results/<timestamp>/` and will not match these numbers on another machine.

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
