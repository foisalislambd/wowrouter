# Benchmarks

How much time WowRouter adds to a chat request, measured on one machine against a mock provider that answers immediately. The harness is in `bench/`. This page says what is measured, how, and how to run it. The numbers in [Results](#results) are one real run, not an estimate.

Antirion, the gateway in the sibling repository, publishes a multi-machine comparison against Bifrost and LiteLLM. WowRouter is a local router: it only listens on a loopback address, and every chat call is authenticated, rewritten, and written to a local activity log. This benchmark keeps Antirion's idea (open-loop overhead against an instant upstream, plus a closed loop, rejections, streaming, memory, and a saturation ladder) and changes the parts that do not fit.

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
| Target | WowRouter, or the harness's loopback proxy, one at a time |

The loopback proxy is a Go `httputil.ReverseProxy` with no authentication, no model rewrite, and no activity log. It is a baseline for the cost of an extra HTTP hop on this machine. It is not another product.

Bifrost and LiteLLM are not in this run. Comparing them fairly is what Antirion's harness does, with the gateway on its own machine. WowRouter cannot be moved off loopback, so that layout is not available here.

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
| h1 | Simple chat, the headline | Open loop, 500 requests/s, through WowRouter and through the loopback proxy | 2s warm-up + 5s measure, 3 reps |
| closed-64 | Throughput with connections kept busy | 64 concurrent clients, WowRouter and the proxy | 2s + 5s, 3 reps |
| stream | Time to first byte | Open loop, 200 requests/s, SSE | 2s + 5s, 3 reps |
| chat-1000 | Simple chat, heavier open loop | 1,000 requests/s | 2s + 5s, 3 reps |
| chat-5000 | The rate Antirion uses as its headline | 5,000 requests/s | 2s + 3s, 3 reps |
| reject-key | A bearer token the router does not know | 2,000 requests/s, expects 401, no upstream call | 1s + 4s, 3 reps |
| reject-model | Model id `openai/bench-unknown` | 2,000 requests/s, expects 404 | 1s + 4s, 3 reps |
| idle | Resident memory with no chat load | WowRouter and the proxy | 3 reps |
| ladder | Highest open-loop rate that passes | 100, then 250, 500, 1000, 2000, 4000, 8000 | 1s + 3s, 1 rep, stop at the first miss |

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

Measured on 2026-11-01 from 10:53:25Z to 11:00:13Z. The router binary was `go build -trimpath` of commit `ba563c3` (WowRouter 1.1.8). That commit is the server this run measured; the harness did not change it. The machine was a KVM guest reporting `Intel(R) Xeon(R) Processor`, 4 CPUs, GOMAXPROCS 4, MemTotal 16003.2 MiB, kernel `Linux 6.12.94+`, Go 1.26.5. Load average at the start was 0.18 0.26 0.11. The chat request was 415 bytes and the mock completion was 248 bytes.

The mock self-test, 2,000 requests/s straight to the mock, returned p50 611 µs, p99 1.40 ms, 4,000 of 4,000 successful.

Figures below are medians of the repetitions. Every row is also in [bench/results/published/report.md](../bench/results/published/report.md), including CPU, the late fraction, and each repetition. `summary.json` next to it is the source.

### Simple chat at 500 requests per second

2s warm-up, 5s measure, 3 repetitions. Every request succeeded. About 8% of WowRouter's sends and 7% of the direct sends started more than 1ms after their scheduled time, so the absolute latencies include a little scheduler delay. Overhead subtracts the direct run taken in the same repetition.

| | WowRouter | Loopback proxy | Direct |
| --- | ---: | ---: | ---: |
| Overhead p50 | 688 µs | 152 µs | — |
| Overhead p99 | 1.42 ms | 207 µs | — |
| Latency p50 | 1.47 ms | 897 µs | 776 µs |
| Latency p99 | 2.82 ms | 1.61 ms | 1.41 ms |
| Latency p99.9 | 3.74 ms | 2.58 ms | 1.67 ms |
| Success | 100% (2500/2500) | 100% (2500/2500) | 100% (2500/2500) |
| CPU per request | 708 µs | 264 µs | — |
| CPU | 0.35 cores | 0.13 cores | — |
| Peak RSS | 25.5 MiB | 14.0 MiB | — |
| Ready | 282 ms | 32 ms | — |

The three WowRouter overhead p50 values were 861 µs, 688 µs and 678 µs. The direct column is the direct run paired with WowRouter. The proxy's own direct run was p50 739 µs, and its overhead is against that run.

At this rate the router used about a third of one core. The mock used 0.05 cores and the generator 0.15, so the machine was not full.

### Other cells

| Scenario | WowRouter | Loopback proxy | Direct |
| --- | --- | --- | --- |
| 64 connections, success rate | 2,006 req/s | 20,072 req/s | 62,447 req/s |
| 64 connections, latency p50 / p99 | 30.12 ms / 65.68 ms | 3.03 ms / 7.73 ms | 735 µs / 4.07 ms |
| 64 connections, overhead p50 / p99 | 29.39 ms / 61.61 ms | 2.30 ms / 3.70 ms | — |
| Streaming, 200 requests/s, TTFT p50 / p99 | 1.27 ms / 2.07 ms | — | 850 µs / 1.55 ms |
| Streaming, TTFT overhead p50 / p99 | 422 µs / 565 µs | — | — |
| Streaming, total overhead p50 / p99 | 1.22 ms / 1.74 ms | — | — |
| 1,000 requests/s, overhead p50 / p99 | 721 µs / 1.58 ms | — | p50 626 µs |
| 5,000 requests/s, latency p50 / p99 | 6.12 s / 8.59 s | — | 584 µs / 1.41 ms |
| 5,000 requests/s, success | 95.38% (14307/15000) | — | 100% (15000/15000) |
| Unknown key, 2,000 requests/s, p50 / p99 | 606 µs / 1.48 ms | — | — |
| Unknown model, 2,000 requests/s, p50 / p99 | 1.05 ms / 3.88 ms | — | — |
| Idle RSS | 23.2 MiB | 8.0 MiB | — |
| Ready, no chat load | 280 ms | 31 ms | — |

Closed loop, three repetitions of WowRouter: 1,744, 2,006 and 2,116 successful requests/s, all with no errors. Latency there is high because 64 clients stay busy and the router serves them one SQLite connection at a time. CPU was 1.11 cores and 528 µs per request. The same 64 clients against the mock, with the router stopped, reached 62,447 req/s at p50 735 µs. The loopback proxy reached 20,072 req/s at p50 3.03 ms.

At 1,000 requests/s every request succeeded (5,000 of 5,000 in the median repetition) and p99 overhead stayed at 1.58 ms. CPU was 0.57 cores.

At 5,000 requests/s the direct run still succeeded for all 15,000 requests at p50 584 µs. WowRouter did not keep the schedule. Every send was more than 1ms late. Of the requests that finished, p50 was 6.12 s and p99 was 8.59 s, against an 8s cap in the generator. The median repetition finished 14,307 of 15,000 (95.38%). The three repetitions finished 14,120, 15,000 and 14,307; the two short ones left 880 and 693 requests unsent (`not_sent`). CPU stayed at 1.03 cores and 598 µs per started request, and peak RSS rose to 85.1 MiB. The time was queueing, not a busier core.

An unknown router key at 2,000 requests/s, which is rejected before the activity log, was p50 606 µs and p99 1.48 ms, 8,000 of 8,000, 114 µs of CPU per request. An unknown model, which is logged, was p50 1.05 ms and p99 3.88 ms, 286 µs of CPU per request, also with no errors.

Idle memory is three samples with no chat load: WowRouter 23.2 MiB, the proxy 8.0 MiB. Ready time for WowRouter was 280 ms, including catalog startup and saving the provider and key.

### Saturation ladder

One repetition per step, 1s warm-up and 3s measure. A step passes at 99.5% success, p99 overhead of at most 5ms, and a clean direct run. The ladder stops at the first miss. It does not try 4,000 or 8,000 after 2,000 fails.

| Offered | Success | p50 | p99 | Overhead p50 | Overhead p99 | Direct p99 | Result |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 100 rps | 300/300 | 2.29 ms | 3.53 ms | 1.37 ms | 1.79 ms | 1.74 ms | pass |
| 250 rps | 750/750 | 1.95 ms | 2.92 ms | 1.09 ms | 1.28 ms | 1.64 ms | pass |
| 500 rps | 1500/1500 | 1.52 ms | 3.23 ms | 747 µs | 1.77 ms | 1.46 ms | pass |
| 1,000 rps | 3000/3000 | 1.24 ms | 2.85 ms | 595 µs | 1.43 ms | 1.42 ms | pass |
| 2,000 rps | 6000/6000 | 540.62 ms | 1.25 s | 540.03 ms | 1.24 s | 1.40 ms | stop |

Highest passing step: **1,000 requests/s**. The 2,000 step still returned every response, and the direct p99 was 1.40 ms, but p99 overhead was 1.24 s. That matches the closed-loop result: past roughly 1,000–2,000 requests/s the wait is the queue, not the mock.
