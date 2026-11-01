# Benchmarks

How much time WowRouter adds to a chat request, measured on one machine against a mock provider that answers immediately. The harness is in `bench/`. This page says what is measured, how, and how to run it. The numbers in [Results](#results) are one real run, not an estimate.

WowRouter is a local router: it only listens on a loopback address, and every chat call is authenticated, rewritten, and written to a local activity log. This benchmark measures open-loop overhead against an instant upstream, plus a closed loop, rejections, streaming, memory, and a saturation ladder.

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

A direct run is clean when at least 99.5% of its requests succeed and its p99 is at most 5ms. On this shared machine the direct path itself is about 1–2ms, so a 1ms rule would fail every cell. Cells that miss the 5ms rule are still reported. They are marked in the run's `report.md`.

## How it is measured

### Machine

One Linux machine runs all three roles:

| Role | What it is |
| --- | --- |
| Generator | `wowrouter-bench`, open loop or closed loop, up to 1024 requests in flight |
| Mock | The same binary in mock mode. It answers `POST /v1/chat/completions` with a fixed JSON body, or a short SSE stream, as soon as it has read the request. No scripted delay. |
| Target | WowRouter, or the harness's loopback proxy, one at a time |

The loopback proxy is a Go `httputil.ReverseProxy` with no authentication, no model rewrite, and no activity log. It is a baseline for the cost of an extra HTTP hop on this machine. It is not another product.

Bifrost and LiteLLM are not in this run. WowRouter cannot be moved off loopback, so a layout with other gateways on their own machines is not available here.

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
| h1 | Simple chat, the headline | Open loop, 500 requests/s, through WowRouter and through the loopback proxy | 2s warm-up + 5s measure, 3 reps |
| closed-64 | Throughput with connections kept busy | 64 concurrent clients, WowRouter and the proxy | 2s + 5s, 3 reps |
| stream | Time to first byte | Open loop, 200 requests/s, SSE | 2s + 5s, 3 reps |
| chat-1000 | Simple chat, heavier open loop | 1,000 requests/s | 2s + 5s, 3 reps |
| chat-5000 | A heavy open loop | 5,000 requests/s | 2s + 3s, 3 reps |
| reject-key | A bearer token the router does not know | 2,000 requests/s, expects 401, no upstream call | 1s + 4s, 3 reps |
| reject-model | Model id `openai/bench-unknown` | 2,000 requests/s, expects 404 | 1s + 4s, 3 reps |
| idle | Resident memory with no chat load | WowRouter and the proxy | 3 reps |
| ladder | Highest open-loop rate that passes | 100, then 250, 500, 1000, 2000, 4000, 8000 | 1s + 3s, 1 rep, stop at the first miss |

`-quick` runs a smaller h1, a closed loop of 8 connections, and the unknown-key cell, one repetition each. Do not publish those numbers.

## What the router does on each request

The headline path is `POST /v1/chat/completions` as a normal client sends it:

1. Check the bearer token against an in-memory map of router-key hashes. A token that does not start with `sk-wowrouter-` stops here.
2. Read that key's row from SQLite so the call can carry its project and team.
3. Resolve `openai/gpt-4o-mini` from the in-memory snapshot and take the provider key from the same snapshot.
4. Rewrite the JSON body to the upstream model id.
5. Call the mock and read the response.
6. Queue an activity-log row for one background SQLite writer. If that queue is full, the row is dropped. The benchmark leaves the log on.

The exact response cache is on by default. This run turns it off with `PUT /api/cache` before the load, so a repeated body still calls the mock. An unknown router key is rejected before the model lookup. An unknown model is rejected from the snapshot and then logged.

The proxy skips all of that and forwards the bytes.

## Reproducing the results

From the repository root, on Linux, with Go 1.26 or newer:

```bash
./bench/run.sh
```

`npm run bench` is the same command. The first build compiles the server, which takes longer than a later one. The harness writes `summary.json` and `report.md` under `bench/results/<timestamp>/`. Pass `-out` to choose the directory. Pass `-cells h1,idle` to run part of the matrix. Pass `-quick` for a smoke run.

The run recorded in this document used:

```bash
./bench/run.sh -out bench/results/published
```

Run it on the machine you care about. A laptop and this virtual machine will not match, and a second run on the same machine will move by a small amount. The committed `bench/results/published/summary.json` is the run the tables below were taken from.

## Results

Measured on 2026-11-01 starting 17:20:22Z. The router binary was `go build -trimpath` of WowRouter 1.1.8. The machine was a KVM guest reporting `Intel(R) Xeon(R) Processor`, 4 CPUs, GOMAXPROCS 4, MemTotal 16003.2 MiB, kernel `Linux 6.12.94+`, Go 1.26.5. Load average at the start was 1.17 0.33 0.12. The chat request was 415 bytes and the mock completion was 248 bytes. The exact response cache was off.

The mock self-test, 2,000 requests/s straight to the mock, returned p50 569 µs, p99 1.34 ms, 4,000 of 4,000 successful.

Figures below are medians of the repetitions. Every row is also in [bench/results/published/report.md](../bench/results/published/report.md), including CPU, the late fraction, and each repetition. `summary.json` next to it is the source.

### Simple chat at 500 requests per second

2s warm-up, 5s measure, 3 repetitions. Every request succeeded. About 8% of WowRouter's sends and 7% of the direct sends started more than 1ms after their scheduled time, so the absolute latencies include a little scheduler delay. Overhead subtracts the direct run taken in the same repetition.

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

### Other cells

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
