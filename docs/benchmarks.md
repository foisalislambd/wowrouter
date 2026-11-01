# Benchmarks

How much time WowRouter adds to a chat request, measured on one machine against a mock provider that answers immediately, next to every other gateway that could be installed and started on that machine. The harness is in `bench/`. This page says what is measured, how, and how to run it. The numbers in [Results](#results) are one real run, not an estimate, and they are not copied from anyone else's README.

WowRouter is one local gateway: it listens on a loopback address, and every chat call is authenticated, rewritten, and written to a local activity log. The harness also starts the other gateways that can be installed on the same machine. This benchmark measures open-loop overhead against an instant upstream, plus a closed loop, rejections, streaming, memory, and a saturation ladder. The WowRouter numbers in [Results](#results) are the later run of that single gateway. Peer-gateway numbers from an earlier run are in [Peer gateways](#peer-gateways).

- [What is measured](#what-is-measured)
- [How it is measured](#how-it-is-measured)
- [Scenarios](#scenarios)
- [What the router does on each request](#what-the-router-does-on-each-request)
- [Reproducing the results](#reproducing-the-results)
- [Results](#results)
- [Peer gateways](#peer-gateways)

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

A direct run is clean when at least 99.5% of its requests succeed and its p99 is at most 5ms. On this shared machine the direct path itself is about 1–2ms, so a 1ms rule would fail every cell. Cells that miss the 5ms rule are still reported. They are marked in the run's `report.md`.

## How it is measured

### Machine

One Linux machine runs all three roles:

| Role | What it is |
| --- | --- |
| Generator | `wowrouter-bench`, open loop or closed loop, up to 1024 requests in flight |
| Mock | The same binary in mock mode. It answers `POST /v1/chat/completions` with a fixed JSON body, or a short SSE stream, as soon as it has read the request. No scripted delay. |
| Target | One gateway at a time. See the list under [Results](#results). |

The loopback proxy is a Go `httputil.ReverseProxy` with no authentication, no model rewrite, and no activity log. It is a baseline for the cost of an extra HTTP hop on this machine. It is not another product.

The gateway, the generator, and the mock share the CPUs. Antirion's published comparison puts each role on its own c7i machine and uses five repetitions of 10s warm-up and 30s measure. This harness uses the shorter windows already published for WowRouter, three repetitions, and does not claim those AWS numbers. WowRouter stays on loopback. Other products are started on this same machine when `bench/setup-targets.sh` has installed them.

The generator schedules an open-loop request by sleeping until its send time. It does not spin. Kernel sleep is often about a millisecond late; that lateness is counted, and it is also present in the direct run, which is why overhead is the figure to compare.

A request the generator cannot hand to a worker within 8 seconds of its scheduled time is a `not_sent` error. That bound keeps a rate the router cannot sustain from running for many minutes.

### Procedure

- The server binary is `go build -trimpath` of `./apps/server/cmd/wowrouter`. The harness binary is built the same way.
- Each WowRouter repetition gets a new data directory. Startup opens SQLite, then the harness saves an OpenAI key, points the base URL at the mock, turns on `gpt-4o-mini`, creates one router key, and turns the exact response cache off.
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
| chat-5000 | A heavy open loop | 5,000 requests/s | 2s + 3s, 3 reps |
| reject-key | A bearer token the gateway does not know | 2,000 requests/s. WowRouter expects 401 and does not call upstream. Skipped when the build has no stored client key | 1s + 4s, 3 reps |
| reject-model | A model id the gateway should refuse | 2,000 requests/s. WowRouter uses `openai/bench-unknown` and expects 404. Skipped when the product forwards the name upstream | 1s + 4s, 3 reps |
| idle | Resident memory with no chat load | Every installed target | 3 reps |
| ladder | Highest open-loop rate that passes | 100, then 250, 500, 1000, 2000, 4000, 8000, per gateway | 1s + 3s, 1 rep, stop at that gateway's first miss |

`-quick` runs a smaller h1, a closed loop of 8 connections, and the unknown-key cell, one repetition each. Do not publish those numbers.

## What the router does on each request

The headline path is `POST /v1/chat/completions` as a normal client sends it:

1. Check the bearer token against an in-memory map of router-key hashes. A token that does not start with `sk-wowrouter-` stops here.
2. Read that key's row from SQLite so the call can carry its project and team.
3. Resolve `openai/gpt-4o-mini` from the in-memory snapshot and take the provider key from the same snapshot.
4. Rewrite the JSON body to the upstream model id.
5. Call the mock and read the response.
6. Queue an activity-log row for one background SQLite writer. If that queue is full, the row is dropped. The benchmark leaves the log on.

The exact response cache is on by default. This run turns it off with `PUT /api/cache` before the load, so a repeated body still calls the mock. An unknown router key is rejected before the model lookup. An unknown model is rejected from the snapshot and then logged. A streamed response is SSE ending in `data: [DONE]`.

The harness can also start the same gateway with the admin model name `chat` (`-targets virtual`): one provider, one deployment of `gpt-4o-mini`, that model, and the response cache off. That is the same engine, not a second router. The published WowRouter tables use `openai/gpt-4o-mini`.

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

`npm run bench` builds WowRouter and runs the harness without `-out`. The harness writes `summary.json` and `report.md` under `bench/results/<timestamp>/`. Pass `-cells h1,idle` to run part of the matrix. Pass `-targets wowrouter,proxy` to run part of the gateway list. The admin model `chat` is `-targets virtual`. Pass `-quick` for a smoke run. Do not publish `-quick`.

The run recorded in this document used:

```bash
./bench/setup-targets.sh
./bench/run.sh -out bench/results/published
```

Run it on the machine you care about. A laptop and this virtual machine will not match, and a second run on the same machine will move by a small amount. The committed `bench/results/published/summary.json` is the run the tables below were taken from.

## Results

Measured on 2026-11-01 starting 17:20:22Z. The router binary was `go build -trimpath` of WowRouter 1.1.8. The machine was a KVM guest reporting `Intel(R) Xeon(R) Processor`, 4 CPUs, GOMAXPROCS 4, MemTotal 16003.2 MiB, kernel `Linux 6.12.94+`, Go 1.26.5. Load average at the start was 1.17 0.33 0.12. The chat request was 415 bytes and the mock completion was 248 bytes. The exact response cache was off. This run measured WowRouter and the loopback proxy.

The mock self-test, 2,000 requests/s straight to the mock, returned p50 569 µs, p99 1.34 ms, 4,000 of 4,000 successful.

Figures below are medians of the repetitions. Every cell, including each repetition, is in [bench/results/published/report.md](../bench/results/published/report.md). `summary.json` next to it is the source.

Within a cell the targets run in turn, then the next repetition starts, so a slow target does not only occupy the first minutes of the run. The direct run for a repetition starts after that target's process has stopped.

### Comparison

| | WowRouter | Loopback proxy | Direct |
| --- | ---: | ---: | ---: |
| Overhead p50 | 269 µs | 102 µs | — |
| Overhead p99 | 469 µs | 114 µs | — |
| Latency p50 | 1.04 ms | 850 µs | 762 µs |
| Latency p99 | 1.87 ms | 1.60 ms | 1.41 ms |
| Latency p99.9 | 2.96 ms | 2.23 ms | 2.00 ms |
| Success | 100% (2500/2500) | 100% (2500/2500) | 100% (2500/2500) |
| CPU per request | 596 µs | 228 µs | — |
| CPU | 0.30 cores | 0.11 cores | — |
| Peak RSS | 22.7 MiB | 13.8 MiB | — |
| Ready | 37 ms | 31 ms | — |

At this rate the router used about a third of one core. The mock used 0.05 cores and the generator 0.13.


| Scenario | WowRouter | Loopback proxy | Direct |
| --- | --- | --- | --- |
| 64 connections, success rate | 6,744 req/s | 19,816 req/s | 55,455 req/s |
| 64 connections, latency p50 / p99 | 7.97 ms / 30.95 ms | 3.10 ms / 7.83 ms | 809 µs / 5.05 ms |
| 64 connections, overhead p50 / p99 | 7.21 ms / 26.70 ms | 2.27 ms / 3.16 ms | — |
| Streaming, 200 requests/s, TTFT p50 / p99 | 1.23 ms / 2.15 ms | — | 896 µs / 1.59 ms |
| Streaming, TTFT overhead p50 / p99 | 336 µs / 523 µs | — | — |
| Streaming, total overhead p50 / p99 | 351 µs / 548 µs | — | — |
| 1,000 requests/s, overhead p50 / p99 | 338 µs / 641 µs | — | p50 635 µs |
| 5,000 requests/s, latency p50 / p99 | 2.28 ms / 16.00 ms | — | 572 µs / 1.41 ms |
| 5,000 requests/s, success | 100% (15000/15000) | — | 100% (15000/15000) |
| Unknown key, 2,000 requests/s, p50 / p99 | 587 µs / 1.37 ms | — | — |
| Unknown model, 2,000 requests/s, p50 / p99 | 718 µs / 2.12 ms | — | — |
| Idle RSS | 13.8 MiB | 7.9 MiB | — |
| Ready, no chat load | 36 ms | 31 ms | — |

The closed loop at 64 connections finished 6,744 requests/s in the median repetition, with no errors. Peak resident memory in that full-matrix run was 557.2 MiB, before the activity-log queue was capped. A later run of only that cell peaked at 30.7 MiB, with p50 7.32–8.81 ms and about 6,200–7,500 requests/s, and no errors. The direct run's p99 in the full-matrix cell was 5.05 ms, which is outside the 5 ms baseline rule, so that overhead is noisier. The loopback proxy reached 19,816 req/s at p50 3.10 ms.

At 1,000 requests/s every request succeeded and p99 overhead was 641 µs. At 5,000 requests/s every request still finished (15,000 of 15,000) at p50 2.28 ms, and p99 overhead was 13.88 ms. Peak RSS in that cell was 258.9 MiB.

An unknown router key at 2,000 requests/s was p50 587 µs and p99 1.37 ms, 8,000 of 8,000. An unknown model was p50 718 µs and p99 2.12 ms, also with no errors.

Idle memory with no chat load: WowRouter 13.8 MiB, the proxy 7.9 MiB. Ready time for WowRouter was 36 ms, including saving the provider and key.

### Saturation ladder

One repetition per step, 1s warm-up and 3s measure. A step passes at 99.5% success, p99 overhead of at most 5ms, and a clean direct run. The ladder stops at the first miss.

| Offered | Success | p50 | p99 | Overhead p50 | Overhead p99 | Direct p99 | Result |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 100 rps | 300/300 | 1.12 ms | 2.15 ms | 291 µs | 709 µs | 1.44 ms | pass |
| 250 rps | 750/750 | 1.23 ms | 1.90 ms | 400 µs | 412 µs | 1.49 ms | pass |
| 500 rps | 1500/1500 | 983 µs | 1.71 ms | 260 µs | 299 µs | 1.41 ms | pass |
| 1,000 rps | 3000/3000 | 964 µs | 1.78 ms | 339 µs | 443 µs | 1.34 ms | pass |
| 2,000 rps | 6000/6000 | 834 µs | 2.31 ms | 262 µs | 982 µs | 1.33 ms | pass |
| 4,000 rps | 12000/12000 | 1.35 ms | 7.49 ms | 776 µs | 6.13 ms | 1.36 ms | stop |

Highest passing step: **2,000 requests/s**. The 4,000 step still returned every response, and the direct p99 was 1.36 ms, but p99 overhead was 6.13 ms.

## Peer gateways

An earlier run on the same machine, 2026-11-01 from 13:55:20Z to 15:10:34Z, measured WowRouter at commit `35fdf61` together with the other products that started here. That binary still had two configurations, and its WowRouter rows are not the current gateway. Use the tables above for WowRouter. The other rows are that run. The files are [bench/results/comparison/report.md](../bench/results/comparison/report.md) and `summary.json` beside it. Load average at the start was 3.48 3.21 2.02. The mock self-test was p50 577 µs, p99 1.34 ms, 4,000 of 4,000.

Overhead and latency are the 500 requests/s chat cell. Idle RSS is the separate no-load cell. Peak RSS is during the 500 requests/s cell. "Highest sustained" is the ladder. Unknown-key and unknown-model latencies are at 2,000 requests/s. A dash means that cell was not scored.

| Gateway | Overhead p50 | Overhead p99 | Latency p50 | Latency p99 | CPU / request | Peak RSS | Idle RSS | 64-conn req/s | 64-conn p50 | Highest sustained | Unknown key p50 | Unknown model p50 | Errors at 500 rps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| WowRouter, earlier binary | 673 µs | 1.30 ms | 1.42 ms | 2.66 ms | 632 µs | 26.4 MiB | 24.2 MiB | 1,901 | 31.87 ms | 1,000 rps | 605 µs | 1.02 ms | 0 |
| WowRouter model `chat`, earlier binary | 1.09 ms | 2.06 ms | 1.83 ms | 3.45 ms | 856 µs | 29.4 MiB | 23.9 MiB | 1,512 | 41.34 ms | 1,000 rps | 607 µs | 2.05 s | 0 |
| Loopback proxy | 65 µs | 207 µs | 852 µs | 1.59 ms | 224 µs | 14.1 MiB | 8.1 MiB | 19,187 | 3.15 ms | 8,000 rps | — | — | 0 |
| Antirion | 254 µs | 400 µs | 1.02 ms | 1.79 ms | 292 µs | 129.4 MiB | 118.1 MiB | 18,818 | 3.04 ms | 8,000 rps | 617 µs | 586 µs | 0 |
| Bifrost | 423 µs | 532 µs | 1.18 ms | 1.91 ms | 764 µs | 345.1 MiB | 271.3 MiB | 7,381 | 7.45 ms | 100 rps | 748 µs | 768 µs | 0 |
| LiteLLM | 52.69 ms | 311.26 ms | 53.44 ms | 312.65 ms | — | 294.6 MiB | 294.8 MiB | 598 | 83.53 ms | none | 1.18 s | 5.43 s | 0 |
| OmniRoute | — | — | — | — | 468 µs | 139.3 MiB | 130.0 MiB | 0 | — | none | 2.49 s | — | 2,500 |
| Portkey | 831 µs | 2.41 ms | 1.59 ms | 3.79 ms | 1,240 µs | 179.2 MiB | 94.9 MiB | 2,834 | 20.86 ms | 250 rps | — | — | 0 |
| Helicone | 369 µs | 652 µs | 1.08 ms | 2.02 ms | 384 µs | 46.7 MiB | 42.4 MiB | 16,872 | 3.60 ms | 8,000 rps | — | — | 0 |

The direct run paired with that earlier WowRouter binary at 500 requests/s was p50 748 µs and p99 1.37 ms, 2,500 of 2,500. The same 64 clients against the mock, with the gateway stopped, reached 62,724 req/s at p50 714 µs in that paired direct run.

LiteLLM's CPU column is blank because the counter on the sampled process tree stayed at 0 while requests were being served. That is a gap in the sample, not a finding that LiteLLM used no CPU. Memory for LiteLLM is the resident set the harness could see (about 295 MiB).

OmniRoute's 2,500 errors at 500 requests/s are requests that did not finish inside 8 seconds. Its unknown-key cell did run, and succeeded as HTTP 401, but the requests queued: p50 2.49 s at 2,000 requests/s.

At 5,000 requests/s, that earlier WowRouter binary's median repetition finished 15,000 of 15,000 at p50 5.55 s and p99 7.87 s. The three repetitions finished 15,000, 15,000 and 14,238; the short one left 762 unsent. The model `chat` configuration finished 10,326 of 15,000 in the median repetition, p50 7.37 s. Antirion finished 15,000 of 15,000 at p50 408 µs. Helicone finished 15,000 of 15,000 at p50 428 µs. Bifrost finished 15,000 of 15,000 at p50 940 µs, with p99 21.10 ms. The direct run was p50 577 µs. Negative overheads at that rate (a few hundred microseconds for Antirion and Helicone) mean the gateway's percentile was below the direct run's in that repetition. On a shared machine that happens when the direct run draws the noisier slice of CPU.

Streaming at 200 requests/s, time-to-first-byte overhead p50 on that run: the earlier WowRouter binary 430 µs, the proxy 134 µs, Antirion 409 µs, Bifrost 590 µs, LiteLLM 6.61 ms. The model `chat` configuration, Portkey, and Helicone failed the body or status check on that binary, so they have no streaming row. The current gateway's streaming row is in the table above.

The ladder's highest passing step on that run was 1,000 rps for both WowRouter configurations, 8,000 rps for the proxy, Antirion, and Helicone, 100 rps for Bifrost, and 250 rps for Portkey. LiteLLM and OmniRoute passed no step. The ladder stops at 8,000, so "8,000 rps" means every step through 8,000 passed, not that a higher rate was tried. The current gateway's ladder, in the section above, passes through 2,000 requests/s.
