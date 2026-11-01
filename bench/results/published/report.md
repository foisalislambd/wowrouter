# WowRouter benchmark 2026-11-01T10:53:25Z

Version 1.1.8, commit ba563c3. Binary `/workspace/bench/bin/wowrouter`.

Machine: Intel(R) Xeon(R) Processor, 4 CPUs, GOMAXPROCS 4, memory 16003.2 MiB, kernel Linux 6.12.94+, load average at start 0.18 0.26 0.11. Go go1.26.5, linux/amd64.

Chat request 415 bytes, mock completion 248 bytes.

Mock self-test (direct): p50 611 µs, p99 1.40 ms, success 100.00% (4000/4000).

- The generator, the mock, and the target share one machine. This is a local measurement, in the spirit of Antirion's laptop topology, not its isolated c7i reference run.
- WowRouter is measured as it ships. Each chat request checks the router key, resolves the model, rewrites the body, calls the upstream, updates the account, and appends the activity log. Those database calls share one SQLite connection. Nothing in this run turns that off.
- The loopback proxy is a baseline that lives in this harness: a Go reverse proxy with no authentication, no rewrite, and no request log. It is not another product.
- Open-loop latency starts at the scheduled send time, so time spent waiting for a slow target counts. Closed-loop latency starts when the attempt starts.
- Overhead is the target percentile minus the direct-run percentile from the same repetition. Latency and overhead are medians of those per-repetition values, so the overhead cell is not always the subtraction of the two latency cells.
- A direct run is clean when at least 99.5% of its requests succeed and its p99 is within 5ms. Antirion's dedicated-mock rule is 1ms; that bound does not hold on this shared machine, where the direct path itself is about 1–2ms.
- The saturation ladder passes a step at 99.5% success and at most 5ms of p99 overhead, and only when the direct run is clean. It stops at the first step that misses.
- Requests the generator cannot start within 8s of their scheduled time are counted as not_sent errors. The generator caps in-flight requests at 1024.
- Bifrost and LiteLLM are not part of this run. WowRouter listens only on loopback, so this harness cannot place them on separate machines the way Antirion's published comparison does.

## Simple chat at 500 requests per second (h1)

Window 2s warm-up + 5s measure, 3 repetition(s).

| | WowRouter | Loopback proxy | Direct |
| --- | ---: | ---: | ---: |
| Latency p50 | 1.47 ms | 897 µs | 776 µs |
| Latency p99 | 2.82 ms | 1.61 ms | 1.41 ms |
| Latency p99.9 | 3.74 ms | 2.58 ms | 1.67 ms |
| Overhead p50 | 688 µs | 152 µs | — |
| Overhead p99 | 1.42 ms | 207 µs | — |
| Overhead p99.9 | 2.07 ms | 957 µs | — |
| Success | 100.00% (2500/2500) | 100.00% (2500/2500) | 100.00% (2500/2500) |
| Schedule late | 7.920% | 8.680% | 6.880% |
| CPU per request | 708 µs | 264 µs | — |
| CPU | 0.35 cores | 0.13 cores | — |
| Mock CPU | 0.05 cores | 0.05 cores | — |
| Generator CPU | 0.15 cores | 0.15 cores | — |
| Idle RSS | 23.4 MiB | 8.2 MiB | — |
| Peak RSS | 25.5 MiB | 14.0 MiB | — |
| Ready | 282 ms | 32 ms | — |

## Closed loop, 64 connections (closed-64)

Window 2s warm-up + 5s measure, 3 repetition(s).

| | WowRouter | Loopback proxy | Direct |
| --- | ---: | ---: | ---: |
| Latency p50 | 30.12 ms | 3.03 ms | 735 µs |
| Latency p99 | 65.68 ms | 7.73 ms | 4.07 ms |
| Latency p99.9 | 82.27 ms | 9.96 ms | 6.47 ms |
| Overhead p50 | 29.39 ms | 2.30 ms | — |
| Overhead p99 | 61.61 ms | 3.70 ms | — |
| Overhead p99.9 | 76.06 ms | 3.72 ms | — |
| Success | 100.00% (10030/10030) | 100.00% (100361/100361) | 100.00% (312237/312237) |
| Success rate | 2006 req/s | 20072 req/s | 62447 req/s |
| Schedule late | 0.000% | 0.159% | 0.130% |
| CPU per request | 528 µs | 93 µs | — |
| CPU | 1.11 cores | 1.86 cores | — |
| Mock CPU | 0.16 cores | 0.46 cores | — |
| Generator CPU | 0.25 cores | 1.06 cores | — |
| Idle RSS | 23.4 MiB | 8.0 MiB | — |
| Peak RSS | 27.0 MiB | 18.6 MiB | — |
| Ready | 282 ms | 31 ms | — |

## Streaming chat at 200 requests per second (stream)

Window 2s warm-up + 5s measure, 3 repetition(s).

| | WowRouter | Direct |
| --- | ---: | ---: |
| Latency p50 | 2.07 ms | 851 µs |
| Latency p99 | 3.27 ms | 1.56 ms |
| Latency p99.9 | 3.73 ms | 1.74 ms |
| TTFT p50 | 1.27 ms | 850 µs |
| TTFT p99 | 2.07 ms | 1.55 ms |
| TTFT overhead p50 | 422 µs | — |
| TTFT overhead p99 | 565 µs | — |
| Overhead p50 | 1.22 ms | — |
| Overhead p99 | 1.74 ms | — |
| Overhead p99.9 | 1.99 ms | — |
| Success | 100.00% (1000/1000) | 100.00% (1000/1000) |
| Schedule late | 8.600% | 10.100% |
| CPU per request | 810 µs | — |
| CPU | 0.16 cores | — |
| Mock CPU | 0.03 cores | — |
| Generator CPU | 0.07 cores | — |
| Idle RSS | 23.4 MiB | — |
| Peak RSS | 25.1 MiB | — |
| Ready | 282 ms | — |

## Simple chat at 1,000 requests per second (chat-1000)

Window 2s warm-up + 5s measure, 3 repetition(s).

| | WowRouter | Direct |
| --- | ---: | ---: |
| Latency p50 | 1.35 ms | 626 µs |
| Latency p99 | 2.93 ms | 1.34 ms |
| Latency p99.9 | 4.17 ms | 1.76 ms |
| Overhead p50 | 721 µs | — |
| Overhead p99 | 1.58 ms | — |
| Overhead p99.9 | 2.41 ms | — |
| Success | 100.00% (5000/5000) | 100.00% (5000/5000) |
| Schedule late | 5.060% | 4.160% |
| CPU per request | 568 µs | — |
| CPU | 0.57 cores | — |
| Mock CPU | 0.08 cores | — |
| Generator CPU | 0.20 cores | — |
| Idle RSS | 23.2 MiB | — |
| Peak RSS | 25.9 MiB | — |
| Ready | 280 ms | — |

## Simple chat at 5,000 requests per second (chat-5000)

Window 2s warm-up + 3s measure, 3 repetition(s).

| | WowRouter | Direct |
| --- | ---: | ---: |
| Latency p50 | 6.12 s | 584 µs |
| Latency p99 | 8.59 s | 1.41 ms |
| Latency p99.9 | 8.72 s | 2.02 ms |
| Overhead p50 | 6.12 s | — |
| Overhead p99 | 8.59 s | — |
| Overhead p99.9 | 8.71 s | — |
| Success | 95.38% (14307/15000) | 100.00% (15000/15000) |
| Schedule late | 100.000% | 10.140% |
| CPU per request | 598 µs | — |
| CPU | 1.03 cores | — |
| Mock CPU | 0.14 cores | — |
| Generator CPU | 0.25 cores | — |
| Idle RSS | 23.6 MiB | — |
| Peak RSS | 85.1 MiB | — |
| Ready | 249 ms | — |

WowRouter errors across repetitions: not_sent 1573.

## Unknown router key at 2,000 requests per second (reject-key)

Window 1s warm-up + 4s measure, 3 repetition(s).

| | WowRouter |
| --- | ---: |
| Latency p50 | 606 µs |
| Latency p99 | 1.48 ms |
| Latency p99.9 | 3.11 ms |
| Overhead p50 | — |
| Overhead p99 | — |
| Overhead p99.9 | — |
| Success | 100.00% (8000/8000) |
| Schedule late | 6.863% |
| CPU per request | 114 µs |
| CPU | 0.23 cores |
| Mock CPU | 0.00 cores |
| Generator CPU | 0.28 cores |
| Idle RSS | 23.3 MiB |
| Peak RSS | 24.6 MiB |
| Ready | 279 ms |

## Unknown model at 2,000 requests per second (reject-model)

Window 1s warm-up + 4s measure, 3 repetition(s).

| | WowRouter |
| --- | ---: |
| Latency p50 | 1.05 ms |
| Latency p99 | 3.88 ms |
| Latency p99.9 | 5.98 ms |
| Overhead p50 | — |
| Overhead p99 | — |
| Overhead p99.9 | — |
| Success | 100.00% (8000/8000) |
| Schedule late | 6.025% |
| CPU per request | 286 µs |
| CPU | 0.57 cores |
| Mock CPU | 0.00 cores |
| Generator CPU | 0.30 cores |
| Idle RSS | 23.3 MiB |
| Peak RSS | 25.9 MiB |
| Ready | 253 ms |

## Idle memory (idle)

3 repetition(s), sampled after the process is healthy and, for WowRouter, after the provider and key are saved. No chat load.

| | WowRouter | Loopback proxy |
| --- | ---: | ---: |
| Ready | 280 ms | 31 ms |
| Idle RSS | 23.2 MiB | 8.0 MiB |

## Open-loop saturation, simple chat (ladder)

Each step is one repetition, 1s warm-up and 3s measure. The ladder stops at the first step that misses the pass rule.

| Offered | Success | p50 | p99 | Overhead p50 | Overhead p99 | Direct p99 | Result |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 100 rps | 100.00% (300/300) | 2.29 ms | 3.53 ms | 1.37 ms | 1.79 ms | 1.74 ms | pass |
| 250 rps | 100.00% (750/750) | 1.95 ms | 2.92 ms | 1.09 ms | 1.28 ms | 1.64 ms | pass |
| 500 rps | 100.00% (1500/1500) | 1.52 ms | 3.23 ms | 747 µs | 1.77 ms | 1.46 ms | pass |
| 1000 rps | 100.00% (3000/3000) | 1.24 ms | 2.85 ms | 595 µs | 1.43 ms | 1.42 ms | pass |
| 2000 rps | 100.00% (6000/6000) | 540.62 ms | 1.25 s | 540.03 ms | 1.24 s | 1.40 ms | stop |

Highest passing step: **1000 rps**.

Stop note: 2000 rps: p99 overhead was above 5ms.

