# WowRouter benchmark 2026-11-01T17:20:22Z

Version 1.1.8, commit 35fdf61. Binary `/workspace/bench/bin/wowrouter`.

Machine: Intel(R) Xeon(R) Processor, 4 CPUs, GOMAXPROCS 4, memory 16003.2 MiB, kernel Linux 6.12.94+, load average at start 1.17 0.33 0.12. Go go1.26.5, linux/amd64.

Chat request 415 bytes, mock completion 248 bytes.

Mock self-test (direct): p50 569 µs, p99 1.34 ms, success 100.00% (4000/4000).

- The generator, the mock, and the target share one machine. This is a local measurement, not an isolated multi-machine reference run.
- WowRouter is measured as it ships, with the exact response cache turned off. Each chat request checks the router key against an in-memory snapshot, reads that key row from SQLite for project and team, resolves the model from the snapshot, rewrites the body, and calls the upstream. The activity log is queued onto one background SQLite writer.
- The loopback proxy is a baseline that lives in this harness: a Go reverse proxy with no authentication, no rewrite, and no request log. It is not another product.
- Open-loop latency starts at the scheduled send time, so time spent waiting for a slow target counts. Closed-loop latency starts when the attempt starts.
- Overhead is the target percentile minus the direct-run percentile from the same repetition. Latency and overhead are medians of those per-repetition values, so the overhead cell is not always the subtraction of the two latency cells.
- A direct run is clean when at least 99.5% of its requests succeed and its p99 is within 5ms. A 1ms bound does not hold on this shared machine, where the direct path itself is about 1–2ms.
- The saturation ladder passes a step at 99.5% success and at most 5ms of p99 overhead, and only when the direct run is clean. It stops at the first step that misses.
- Requests the generator cannot start within 8s of their scheduled time are counted as not_sent errors. The generator caps in-flight requests at 1024.
- Bifrost and LiteLLM are not part of this run. WowRouter listens only on loopback, so this harness does not place other gateways on separate machines.

## Simple chat at 500 requests per second (h1)

Window 2s warm-up + 5s measure, 3 repetition(s).

| | WowRouter | Loopback proxy | Direct |
| --- | ---: | ---: | ---: |
| Latency p50 | 1.04 ms | 850 µs | 762 µs |
| Latency p99 | 1.87 ms | 1.60 ms | 1.41 ms |
| Latency p99.9 | 2.96 ms | 2.23 ms | 2.00 ms |
| Overhead p50 | 269 µs | 102 µs | — |
| Overhead p99 | 469 µs | 114 µs | — |
| Overhead p99.9 | 965 µs | -393 µs | — |
| Success | 100.00% (2500/2500) | 100.00% (2500/2500) | 100.00% (2500/2500) |
| Schedule late | 7.560% | 8.080% | 7.600% |
| CPU per request | 596 µs | 228 µs | — |
| CPU | 0.30 cores | 0.11 cores | — |
| Mock CPU | 0.05 cores | 0.05 cores | — |
| Generator CPU | 0.13 cores | 0.13 cores | — |
| Idle RSS | 13.8 MiB | 8.1 MiB | — |
| Peak RSS | 22.7 MiB | 13.8 MiB | — |
| Ready | 37 ms | 31 ms | — |

## Closed loop, 64 connections (closed-64)

Window 2s warm-up + 5s measure, 3 repetition(s).

| | WowRouter | Loopback proxy | Direct |
| --- | ---: | ---: | ---: |
| Latency p50 | 7.97 ms | 3.10 ms | 809 µs |
| Latency p99 | 30.95 ms | 7.83 ms | 5.05 ms |
| Latency p99.9 | 45.09 ms | 10.10 ms | 8.30 ms |
| Overhead p50 | 7.21 ms | 2.27 ms | — |
| Overhead p99 | 26.70 ms | 3.16 ms | — |
| Overhead p99.9 | 38.31 ms | 2.46 ms | — |
| Success | 100.00% (33719/33719) | 100.00% (99080/99080) | 100.00% (277275/277275) |
| Success rate | 6744 req/s | 19816 req/s | 55455 req/s |
| Schedule late | 0.052% | 0.183% | 0.146% |
| CPU per request | 276 µs | 92 µs | — |
| CPU | 1.87 cores | 1.82 cores | — |
| Mock CPU | 0.40 cores | 0.44 cores | — |
| Generator CPU | 0.57 cores | 1.05 cores | — |
| Idle RSS | 13.8 MiB | 7.9 MiB | — |
| Peak RSS | 557.2 MiB | 19.1 MiB | — |
| Ready | 38 ms | 31 ms | — |

WowRouter: the median direct run is outside the 5ms p99 baseline rule.

## Streaming chat at 200 requests per second (stream)

Window 2s warm-up + 5s measure, 3 repetition(s).

| | WowRouter | Direct |
| --- | ---: | ---: |
| Latency p50 | 1.25 ms | 898 µs |
| Latency p99 | 2.17 ms | 1.59 ms |
| Latency p99.9 | 2.86 ms | 1.75 ms |
| TTFT p50 | 1.23 ms | 896 µs |
| TTFT p99 | 2.15 ms | 1.59 ms |
| TTFT overhead p50 | 336 µs | — |
| TTFT overhead p99 | 523 µs | — |
| Overhead p50 | 351 µs | — |
| Overhead p99 | 548 µs | — |
| Overhead p99.9 | 490 µs | — |
| Success | 100.00% (1000/1000) | 100.00% (1000/1000) |
| Schedule late | 10.600% | 10.100% |
| CPU per request | 800 µs | — |
| CPU | 0.16 cores | — |
| Mock CPU | 0.03 cores | — |
| Generator CPU | 0.08 cores | — |
| Idle RSS | 13.8 MiB | — |
| Peak RSS | 22.2 MiB | — |
| Ready | 37 ms | — |

## Simple chat at 1,000 requests per second (chat-1000)

Window 2s warm-up + 5s measure, 3 repetition(s).

| | WowRouter | Direct |
| --- | ---: | ---: |
| Latency p50 | 973 µs | 635 µs |
| Latency p99 | 1.99 ms | 1.35 ms |
| Latency p99.9 | 3.78 ms | 1.76 ms |
| Overhead p50 | 338 µs | — |
| Overhead p99 | 641 µs | — |
| Overhead p99.9 | 2.02 ms | — |
| Success | 100.00% (5000/5000) | 100.00% (5000/5000) |
| Schedule late | 6.020% | 4.420% |
| CPU per request | 504 µs | — |
| CPU | 0.50 cores | — |
| Mock CPU | 0.08 cores | — |
| Generator CPU | 0.20 cores | — |
| Idle RSS | 13.6 MiB | — |
| Peak RSS | 23.0 MiB | — |
| Ready | 37 ms | — |

## Simple chat at 5,000 requests per second (chat-5000)

Window 2s warm-up + 3s measure, 3 repetition(s).

| | WowRouter | Direct |
| --- | ---: | ---: |
| Latency p50 | 2.28 ms | 572 µs |
| Latency p99 | 16.00 ms | 1.41 ms |
| Latency p99.9 | 26.31 ms | 1.88 ms |
| Overhead p50 | 1.71 ms | — |
| Overhead p99 | 13.88 ms | — |
| Overhead p99.9 | 23.33 ms | — |
| Success | 100.00% (15000/15000) | 100.00% (15000/15000) |
| Schedule late | 3.173% | 10.100% |
| CPU per request | 307 µs | — |
| CPU | 1.53 cores | — |
| Mock CPU | 0.31 cores | — |
| Generator CPU | 0.52 cores | — |
| Idle RSS | 13.8 MiB | — |
| Peak RSS | 258.9 MiB | — |
| Ready | 40 ms | — |

## Unknown router key at 2,000 requests per second (reject-key)

Window 1s warm-up + 4s measure, 3 repetition(s).

| | WowRouter |
| --- | ---: |
| Latency p50 | 587 µs |
| Latency p99 | 1.37 ms |
| Latency p99.9 | 2.54 ms |
| Overhead p50 | — |
| Overhead p99 | — |
| Overhead p99.9 | — |
| Success | 100.00% (8000/8000) |
| Schedule late | 6.200% |
| CPU per request | 79 µs |
| CPU | 0.16 cores |
| Mock CPU | 0.00 cores |
| Generator CPU | 0.29 cores |
| Idle RSS | 13.8 MiB |
| Peak RSS | 18.7 MiB |
| Ready | 38 ms |

## Unknown model at 2,000 requests per second (reject-model)

Window 1s warm-up + 4s measure, 3 repetition(s).

| | WowRouter |
| --- | ---: |
| Latency p50 | 718 µs |
| Latency p99 | 2.12 ms |
| Latency p99.9 | 3.38 ms |
| Overhead p50 | — |
| Overhead p99 | — |
| Overhead p99.9 | — |
| Success | 100.00% (8000/8000) |
| Schedule late | 7.688% |
| CPU per request | 294 µs |
| CPU | 0.59 cores |
| Mock CPU | 0.00 cores |
| Generator CPU | 0.31 cores |
| Idle RSS | 13.8 MiB |
| Peak RSS | 23.2 MiB |
| Ready | 36 ms |

## Idle memory (idle)

3 repetition(s), sampled after the process is healthy and, for WowRouter, after the provider and key are saved. No chat load.

| | WowRouter | Loopback proxy |
| --- | ---: | ---: |
| Ready | 36 ms | 31 ms |
| Idle RSS | 13.8 MiB | 7.9 MiB |

## Open-loop saturation, simple chat (ladder)

Each step is one repetition, 1s warm-up and 3s measure. The ladder stops at the first step that misses the pass rule.

| Offered | Success | p50 | p99 | Overhead p50 | Overhead p99 | Direct p99 | Result |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 100 rps | 100.00% (300/300) | 1.12 ms | 2.15 ms | 291 µs | 709 µs | 1.44 ms | pass |
| 250 rps | 100.00% (750/750) | 1.23 ms | 1.90 ms | 400 µs | 412 µs | 1.49 ms | pass |
| 500 rps | 100.00% (1500/1500) | 983 µs | 1.71 ms | 260 µs | 299 µs | 1.41 ms | pass |
| 1000 rps | 100.00% (3000/3000) | 964 µs | 1.78 ms | 339 µs | 443 µs | 1.34 ms | pass |
| 2000 rps | 100.00% (6000/6000) | 834 µs | 2.31 ms | 262 µs | 982 µs | 1.33 ms | pass |
| 4000 rps | 100.00% (12000/12000) | 1.35 ms | 7.49 ms | 776 µs | 6.13 ms | 1.36 ms | stop |

Highest passing step: **2000 rps**.

Stop note: 4000 rps: p99 overhead was above 5ms.

