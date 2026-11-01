# Benchmarks

How much time WowRouter adds to a chat request, measured on one machine against a mock provider that answers immediately, next to every other gateway that could be installed and started on that machine. The harness is in `bench/`. This page says what is measured, how, and how to run it. The numbers in [Results](#results) are one real run, not an estimate, and they are not copied from anyone else's README.

Antirion publishes a multi-machine comparison. This run keeps that idea (open-loop overhead against an instant upstream, plus a closed loop, rejections, streaming, memory, and a saturation ladder) and changes the parts that do not fit a shared 4-CPU machine. Both WowRouter paths are included: classic `openai/gpt-4o-mini`, and the virtual model `chat`.

- [What is measured](#what-is-measured)
- [How it is measured](#how-it-is-measured)
- [Scenarios](#scenarios)
- [What the router does on each request](#what-the-router-does-on-each-request)
- [Reproducing the results](#reproducing-the-results)
- [Results](#results)

## What is measured

Every load repetition is a run through the target and, when the target is supposed to call an upstream, a second run straight to the mock (the direct run). Overhead is the target's latency percentile minus the direct run's percentile from that same repetition. The table then takes the median across repetitions.

| Metric | Meaning |
| --- | --- |
| Latency p50 / p99 / p99.9 | Open loop: from the request's scheduled send time to the last byte of the body. Closed loop: from the moment the attempt starts. Queueing in front of a slow target counts. |
| Overhead p50 / p99 / p99.9 | Target percentile minus direct percentile, in the same repetition. The median of those differences is what the tables show, so it can differ slightly from subtracting the two median latencies. |
| TTFT overhead | For streams: the same difference on the time to the first byte. |
| Success | Responses with the expected status and, for a 200, a body that is a chat completion or an SSE stream ending in `[DONE]`. |
| Success rate | Closed loop only: successful attempts per second of the measurement window. |
| Schedule late | Share of open-loop requests whose send started more than 1ms after the scheduled time. |
| CPU per request | CPU time of the target process, including children, during the measurement, divided by requests the generator actually started. 100% of one core is one full core. |
| Idle RSS | Resident memory after the process is healthy. For WowRouter that is after the provider, the model, and the router key are saved, and before the load. Three samples, the median of the samples, then the median across repetitions. |
| Peak RSS | Highest resident-memory sample during the load (about every 50ms). |
| Ready | Time from process start until the target is healthy. For WowRouter this includes saving the provider and the key. |
| Saturation | Highest ladder step that passes. A step passes when the gateway succeeds for at least 99.5% of the offered requests, p99 overhead is at most 5ms, and the direct run is clean. |

Latency percentiles use successful responses only. The percentile is nearest rank: `ceil(p * n) - 1` on the sorted samples.

A direct run is clean when at least 99.5% of its requests succeed and its p99 is at most 5ms. Antirion's reference rule is 1ms, on a mock that has its own machine. On this shared machine the direct path itself is about 1–2ms, so a 1ms rule would fail every cell. Cells that miss the 5ms rule are still reported. They are marked in the run's `report.md`.

## How it is measured

### Machine

One Linux machine runs all three roles:

| Role | What it is |
| --- | --- |
| Generator | `wowrouter-bench`, open loop or closed loop, up to 1024 requests in flight |
| Mock | The same binary in mock mode. It answers `POST /v1/chat/completions` with a fixed JSON body, or a short SSE stream, as soon as it has read the request. No scripted delay. |
| Target | One gateway at a time. See the list under [Results](#results). |

The loopback proxy is a Go `httputil.ReverseProxy` with no authentication, no model rewrite, and no activity log. It is a baseline for the cost of an extra HTTP hop on this machine. It is not another product.

The gateway, the generator, and the mock share the CPUs. Antirion's published comparison puts each role on its own c7i machine and uses five repetitions of 10s warm-up and 30s measure. This run uses the shorter windows already in this harness, three repetitions, and does not claim those AWS numbers.

The generator schedules an open-loop request by sleeping until its send time. It does not spin. Kernel sleep is often about a millisecond late; that lateness is counted, and it is also present in the direct run, which is why overhead is the figure to compare.

A request the generator cannot hand to a worker within 8 seconds of its scheduled time is a `not_sent` error. That bound keeps a rate the router cannot sustain from running for many minutes.

### Procedure

- The server binary is `go build -trimpath` of `./apps/server/cmd/wowrouter`. The harness binary is built the same way.
- Each WowRouter repetition gets a new data directory. Startup loads the provider catalog into SQLite, then the harness saves an OpenAI key, points the base URL at the mock, turns on `gpt-4o-mini`, and creates one router key.
- The public model id is `openai/gpt-4o-mini`. WowRouter rewrites it to `gpt-4o-mini` before it calls the mock. The direct run sends `gpt-4o-mini` itself. The mock ignores the key and the model name.
- The target process is stopped before the direct run, so the direct run does not share the CPU with an idle router.
- Load cells use three repetitions unless noted. The published value of each metric is the median of the repetitions.
- The mock is checked first, at 2,000 requests per second for 2 seconds. The run stops if that self-test succeeds for less than 99% of requests.

### Validity

These runs are not a reference ranking. The generator, the mock, and the target share the CPUs, so a slow target also slows the mock and the generator. Read overhead together with the direct latency, the late fraction, and the CPU figures. A cell where the direct p99 is above 5ms, or where a large share of sends were late, is still a real measurement and a noisier one.

## Scenarios

The chat body is a fixed JSON request of a few hundred bytes (`bench/corpus.go`). The mock's completion is a fixed short JSON object. The stream is a few SSE events ending in `data: [DONE]`.

| Cell | What | Load | Window |
| --- | --- | --- | --- |
| h1 | Simple chat, the headline | Open loop, 500 requests/s, every installed target | 2s warm-up + 5s measure, 3 reps |
| closed-64 | Throughput with connections kept busy | 64 concurrent clients, every installed target | 2s + 5s, 3 reps |
| stream | Time to first byte | Open loop, 200 requests/s, SSE | 2s + 5s, 3 reps |
| chat-1000 | Simple chat, heavier open loop | 1,000 requests/s | 2s + 5s, 3 reps |
| chat-5000 | A high open-loop rate | 5,000 requests/s | 2s + 3s, 3 reps |
| reject-key | A bearer token the gateway does not know | 2,000 requests/s. Status depends on the product. Skipped when the build has no stored client key | 1s + 4s, 3 reps |
| reject-model | A model id the gateway should refuse | 2,000 requests/s. Skipped when the product forwards the name upstream | 1s + 4s, 3 reps |
| idle | Resident memory with no chat load | Every installed target | 3 reps |
| ladder | Highest open-loop rate that passes | 100, then 250, 500, 1000, 2000, 4000, 8000, per gateway | 1s + 3s, 1 rep, stop at that gateway's first miss |

`-quick` runs a smaller h1, a closed loop of 8 connections, and the unknown-key cell, one repetition each. Do not publish those numbers.

## What the router does on each request

The headline path is `POST /v1/chat/completions` as a normal client sends it:

1. Hash the router key and load it from SQLite, then update `last_used_at`.
2. Resolve `openai/gpt-4o-mini` and load the provider key.
3. Expand the provider account and, after a successful upstream call, touch that account.
4. Rewrite the JSON body to the upstream model id.
5. Call the mock and read the response.
6. Insert an activity-log row and delete rows older than the newest 5,000.

Those database calls use one SQLite connection (`SetMaxOpenConns(1)`), with WAL. There is no switch to turn the activity log off, so the benchmark leaves it on. An unknown router key is rejected before the log write. An unknown model is rejected after a log write.

The virtual path is the model name `chat` (no slash). The harness saves one OpenAI-compatible provider, one deployment of `gpt-4o-mini`, and that model, and it turns the response cache off. The default cache would otherwise answer the repeated body without calling the mock. The engine still writes its request log and an activity row. A streamed request on this path came back as HTTP 200 whose body was not an SSE stream ending in `[DONE]`, so the streaming cell was not scored for it.

The proxy skips authentication, rewrite, and logging, and forwards the bytes.

Other products, as configured for this run:

| Gateway | Version | What the harness turned on |
| --- | --- | --- |
| Antirion | 0.1.1, commit `32bebb0d6f8a`, built here because the repo publishes no release binary | One key, request logs off, metrics on, no cache. The key secret is an environment reference, which is what current Antirion requires. |
| Bifrost | 2.4.0 HTTP binary | Logging off, one virtual key, pool 15000 / buffer 20000 / concurrency 10000. Base URL is the mock origin; Bifrost appends `/v1/chat/completions`. An unknown model is HTTP 403. |
| LiteLLM | 1.106.6, `litellm[proxy]`, no database | Master key, spend and error logs off, no cache, one worker per CPU. Unknown key and unknown model are HTTP 400. |
| OmniRoute | npm 3.8.52, headless, bound to 127.0.0.1 | `REQUIRE_API_KEY`, request log off, compression off, cache bypass. Unknown key is HTTP 401. An unknown model is forwarded, so that cell was skipped. At 100 rps and above, chat requests did not finish inside 8s. |
| Portkey | `@portkey-ai/gateway` 1.15.2 | No stored client key. Each request sends `x-portkey-config` with the provider, the upstream key, and `custom_host`. Listens on `--port=19470`. Streaming returned HTTP 500. |
| Helicone | `ai-gateway` 0.2.0-beta.30, the latest published release, which is a beta | Provider `base-url` pointed at the mock. No stored client key. The process listened on port 8080, not 19480. Streaming returned HTTP 200 that was not the expected SSE body. |

Kong AI Gateway was not started: this image has no Docker and no Kong package, and the AI gateway is a Kong plugin. Envoy AI Gateway was not started: it is a Kubernetes controller, and there is no cluster here. TensorZero 2026.6.0 was not started: the GitHub release asset list is empty and the project expects a container plus ClickHouse.

## Reproducing the results

From the repository root, on Linux, with Go 1.26 or newer. Peer gateways need the extra toolchain named in `bench/setup-targets.sh` (Python venv, Node, Rust 1.98.1 for Antirion, and network access to the download URLs).

```bash
./bench/setup-targets.sh
./bench/run.sh -out bench/results/published
```

`npm run bench` builds WowRouter and runs the harness without `-out`. The harness writes `summary.json` and `report.md` under `bench/results/<timestamp>/`. Pass `-cells h1,idle` to run part of the matrix. Pass `-targets wowrouter,virtual` to run part of the gateway list. Pass `-quick` for a smoke run. Do not publish `-quick`.

The run recorded in this document used:

```bash
./bench/setup-targets.sh
./bench/run.sh -out bench/results/published
```

Run it on the machine you care about. A laptop and this virtual machine will not match, and a second run on the same machine will move by a small amount. The committed `bench/results/published/summary.json` is the run the tables below were taken from.

## Results

Measured on 2026-11-01 from 13:55:20Z to 15:10:34Z. The WowRouter binary was `go build -trimpath` of commit `35fdf61` (WowRouter 1.1.8). The machine was a KVM guest reporting `Intel(R) Xeon(R) Processor`, 4 CPUs, GOMAXPROCS 4, MemTotal 16003.2 MiB, kernel `Linux 6.12.94+`, Go 1.26.5. Load average at the start was 3.48 3.21 2.02. The chat request was 415 bytes and the mock completion was 248 bytes.

The mock self-test, 2,000 requests/s straight to the mock, returned p50 577 µs, p99 1.34 ms, 4,000 of 4,000 successful.

Figures below are medians of the repetitions. Every cell, including each repetition, is in [bench/results/published/report.md](../bench/results/published/report.md). `summary.json` next to it is the source.

Within a cell the targets run in turn, then the next repetition starts, so a slow target does not only occupy the first minutes of the run. The direct run for a repetition starts after that target's process has stopped.

### Comparison

Overhead and latency are the 500 requests/s chat cell. Idle RSS is the separate no-load cell. Peak RSS is during the 500 requests/s cell. "Highest sustained" is the ladder. Unknown-key and unknown-model latencies are at 2,000 requests/s. A dash means that cell was not scored.

| Gateway | Overhead p50 | Overhead p99 | Latency p50 | Latency p99 | CPU / request | Peak RSS | Idle RSS | 64-conn req/s | 64-conn p50 | Highest sustained | Unknown key p50 | Unknown model p50 | Errors at 500 rps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| WowRouter classic | 673 µs | 1.30 ms | 1.42 ms | 2.66 ms | 632 µs | 26.4 MiB | 24.2 MiB | 1,901 | 31.87 ms | 1,000 rps | 605 µs | 1.02 ms | 0 |
| WowRouter virtual | 1.09 ms | 2.06 ms | 1.83 ms | 3.45 ms | 856 µs | 29.4 MiB | 23.9 MiB | 1,512 | 41.34 ms | 1,000 rps | 607 µs | 2.05 s | 0 |
| Loopback proxy | 65 µs | 207 µs | 852 µs | 1.59 ms | 224 µs | 14.1 MiB | 8.1 MiB | 19,187 | 3.15 ms | 8,000 rps | — | — | 0 |
| Antirion | 254 µs | 400 µs | 1.02 ms | 1.79 ms | 292 µs | 129.4 MiB | 118.1 MiB | 18,818 | 3.04 ms | 8,000 rps | 617 µs | 586 µs | 0 |
| Bifrost | 423 µs | 532 µs | 1.18 ms | 1.91 ms | 764 µs | 345.1 MiB | 271.3 MiB | 7,381 | 7.45 ms | 100 rps | 748 µs | 768 µs | 0 |
| LiteLLM | 52.69 ms | 311.26 ms | 53.44 ms | 312.65 ms | — | 294.6 MiB | 294.8 MiB | 598 | 83.53 ms | none | 1.18 s | 5.43 s | 0 |
| OmniRoute | — | — | — | — | 468 µs | 139.3 MiB | 130.0 MiB | 0 | — | none | 2.49 s | — | 2,500 |
| Portkey | 831 µs | 2.41 ms | 1.59 ms | 3.79 ms | 1,240 µs | 179.2 MiB | 94.9 MiB | 2,834 | 20.86 ms | 250 rps | — | — | 0 |
| Helicone | 369 µs | 652 µs | 1.08 ms | 2.02 ms | 384 µs | 46.7 MiB | 42.4 MiB | 16,872 | 3.60 ms | 8,000 rps | — | — | 0 |

The direct run paired with classic WowRouter at 500 requests/s was p50 748 µs and p99 1.37 ms, 2,500 of 2,500. The same 64 clients against the mock, with the gateway stopped, reached 62,724 req/s at p50 714 µs in that paired direct run.

LiteLLM's CPU column is blank because the counter on the sampled process tree stayed at 0 while requests were being served. That is a gap in the sample, not a finding that LiteLLM used no CPU. Memory for LiteLLM is the resident set the harness could see (about 295 MiB).

OmniRoute's 2,500 errors at 500 requests/s are requests that did not finish inside 8 seconds. Its unknown-key cell did run, and succeeded as HTTP 401, but the requests queued: p50 2.49 s at 2,000 requests/s.

At 5,000 requests/s, classic WowRouter's median repetition finished 15,000 of 15,000 at p50 5.55 s and p99 7.87 s. The three repetitions finished 15,000, 15,000 and 14,238; the short one left 762 unsent. Virtual finished 10,326 of 15,000 in the median repetition, p50 7.37 s. Antirion finished 15,000 of 15,000 at p50 408 µs. Helicone finished 15,000 of 15,000 at p50 428 µs. Bifrost finished 15,000 of 15,000 at p50 940 µs, with p99 21.10 ms. The direct run was p50 577 µs. Negative overheads at that rate (a few hundred microseconds for Antirion and Helicone) mean the gateway's percentile was below the direct run's in that repetition. On a shared machine that happens when the direct run draws the noisier slice of CPU.

Streaming at 200 requests/s, time-to-first-byte overhead p50: classic WowRouter 430 µs, the proxy 134 µs, Antirion 409 µs, Bifrost 590 µs, LiteLLM 6.61 ms. Virtual, Portkey, and Helicone failed the body or status check described above, so they have no streaming row.

The ladder's highest passing step was 1,000 rps for both WowRouter paths, 8,000 rps for the proxy, Antirion, and Helicone, 100 rps for Bifrost, and 250 rps for Portkey. LiteLLM and OmniRoute passed no step. The ladder stops at 8,000, so "8,000 rps" means every step through 8,000 passed, not that a higher rate was tried.
