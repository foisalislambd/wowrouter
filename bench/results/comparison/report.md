This file is the comparison run from 2026-11-01 13:55Z–15:10Z, commit 35fdf61, before WowRouter was one gateway. The current WowRouter numbers are in bench/results/published/.

# WowRouter benchmark 2026-11-01T13:55:20Z

Version 1.1.8, commit 35fdf61. Binary `/workspace/bench/bin/wowrouter`.

Machine: Intel(R) Xeon(R) Processor, 4 CPUs, GOMAXPROCS 4, memory 16003.2 MiB, kernel Linux 6.12.94+, load average at start 3.48 3.21 2.02. Go go1.26.5, linux/amd64.

Chat request 415 bytes, mock completion 248 bytes.

Mock self-test (direct): p50 577 µs, p99 1.34 ms, success 100.00% (4000/4000).

- The generator, the mock, and the gateway share one machine. This is not Antirion's published layout, where the generator, the mock, and the gateway each have a c7i machine.
- Repetitions are interleaved: within a cell, each gateway runs in turn, then the next repetition starts. The published value is the median of the repetitions.
- WowRouter classic is measured as it ships. Each chat request checks the router key, resolves the model, rewrites the body, calls the upstream, updates the account, and appends the activity log. Those database calls share one SQLite connection. There is no switch to turn that log off.
- WowRouter virtual is the model name chat: one deployment, one gateway key, response cache off. The engine still writes a request log and an activity row. A model id that contains / stays on the classic path.
- The loopback proxy is a baseline that lives in this harness: a Go reverse proxy with no authentication, no rewrite, and no request log. It is not another product.
- Other gateways use one key checked on each request where the build has a key, no cache, and request logging off where the build has that switch. LiteLLM runs one worker per CPU. Bifrost uses the pool sizes from its own published benchmark (15000 / 20000 / 10000 on this 4-CPU machine). Its OpenAI-compatible base URL is the mock origin, because Bifrost appends /v1/chat/completions.
- Windows stay the ones this harness already published for WowRouter: 3 repetitions, mostly 2s warm-up and 5s measure. That is shorter than Antirion's 5 repetitions of 10s warm-up and 30s measure on dedicated AWS machines.
- Portkey's open-source process has no stored client key. Every request sends x-portkey-config with the provider, the upstream key, and custom_host. Helicone's latest published build is 0.2.0-beta.30 and also has no stored client key in this config, so those two skip the rejection cells. OmniRoute forwards an unknown model to the provider, so that cell is skipped; with REQUIRE_API_KEY it does reject an unknown key.
- The direct request body always names gpt-4o-mini. A gateway whose public model id differs (openai/gpt-4o-mini, chat, mockl0/gpt-4o-mini) sends a few different bytes. The mock ignores the model name.
- Open-loop latency starts at the scheduled send time, so time spent waiting for a slow target counts. Closed-loop latency starts when the attempt starts.
- Overhead is the target percentile minus the direct-run percentile from the same repetition. Latency and overhead are medians of those per-repetition values, so the overhead cell is not always the subtraction of the two latency cells.
- A direct run is clean when at least 99.5% of its requests succeed and its p99 is within 5ms. Antirion's dedicated-mock rule is 1ms; that bound does not hold on this shared machine, where the direct path itself is about 1–2ms.
- The saturation ladder passes a step at 99.5% success and at most 5ms of p99 overhead, and only when the direct run is clean. Each gateway has its own ladder, and a ladder stops at that gateway's first miss.
- Requests the generator cannot start within 8s of their scheduled time are counted as not_sent errors. The generator caps in-flight requests at 1024.
- Resident memory is the sum of VmRSS for the gateway process and its live children. Shared pages are counted once per process.

## Targets

| Target | Version | Setup |
| --- | --- | --- |
| WowRouter classic | 1.1.8 | classic provider/model path; activity log on, one SQLite connection |
| WowRouter virtual | 1.1.8 | virtual model chat; response cache off; request log on |
| Loopback proxy | harness | Go reverse proxy in this harness, not another product |
| Antirion | antirion 0.1.1 (32bebb0d6f8a) | P-min: one key, request logs off, no cache, metrics on. Built from the sibling repo. |
| Bifrost | 2.4.0 | logging off, one virtual key, pool 15000 / buffer 20000 / concurrency 10000 |
| LiteLLM | 1.106.6 | master key, no database, spend and error logs off, one worker per CPU |
| OmniRoute | 3.8.52 | headless on 127.0.0.1, REQUIRE_API_KEY, request log off, compression off, cache bypass. Unknown models are forwarded to the provider. |
| Portkey | 1.15.2 | open-source gateway has no stored client key; provider config is the x-portkey-config header, cache unset |
| Helicone | ai-gateway 0.2.0-beta.30 | latest published release is a beta; no stored client key in this build; cache unset |

## Not run

- **Kong AI Gateway.** Docker is not installed, and this Ubuntu image has no Kong package. The AI gateway is a Kong plugin, so it was not started.
- **Envoy AI Gateway.** It runs as a Kubernetes controller. This machine has no Kubernetes cluster and no Docker, so it was not started.
- **TensorZero.** The latest GitHub release, 2026.6.0, publishes no gateway binary (the release asset list is empty) and expects a container plus ClickHouse. Docker is not installed, so it was not started.

## Simple chat at 500 requests per second (h1)

Window 2s warm-up + 5s measure, 3 repetition(s).

| | WowRouter classic | WowRouter virtual | Loopback proxy | Antirion | Bifrost | LiteLLM | OmniRoute | Portkey | Helicone | Direct |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Latency p50 | 1.42 ms | 1.83 ms | 852 µs | 1.02 ms | 1.18 ms | 53.44 ms | 0 µs | 1.59 ms | 1.08 ms | 748 µs |
| Latency p99 | 2.66 ms | 3.45 ms | 1.59 ms | 1.79 ms | 1.91 ms | 312.65 ms | 0 µs | 3.79 ms | 2.02 ms | 1.37 ms |
| Latency p99.9 | 3.04 ms | 3.94 ms | 1.80 ms | 2.05 ms | 6.38 ms | 329.16 ms | 0 µs | 10.14 ms | 2.34 ms | 1.53 ms |
| Overhead p50 | 673 µs | 1.09 ms | 65 µs | 254 µs | 423 µs | 52.69 ms | — | 831 µs | 369 µs | — |
| Overhead p99 | 1.30 ms | 2.06 ms | 207 µs | 400 µs | 532 µs | 311.26 ms | — | 2.41 ms | 652 µs | — |
| Overhead p99.9 | 1.56 ms | 2.41 ms | 142 µs | 516 µs | 4.85 ms | 327.63 ms | — | 8.68 ms | 763 µs | — |
| Success | 100.00% (2500/2500) | 100.00% (2500/2500) | 100.00% (2500/2500) | 100.00% (2500/2500) | 100.00% (2500/2500) | 100.00% (2500/2500) | 0.00% (0/2500) | 100.00% (2500/2500) | 100.00% (2500/2500) | 100.00% (2500/2500) |
| Schedule late | 6.920% | 5.400% | 7.840% | 7.960% | 7.840% | 17.080% | 99.040% | 6.080% | 7.000% | 6.640% |
| CPU per request | 632 µs | 856 µs | 224 µs | 292 µs | 764 µs | 0 µs | 468 µs | 1240 µs | 384 µs | — |
| CPU | 0.32 cores | 0.43 cores | 0.11 cores | 0.15 cores | 0.38 cores | 0.00 cores | 0.03 cores | 0.62 cores | 0.19 cores | — |
| Mock CPU | 0.05 cores | 0.04 cores | 0.05 cores | 0.05 cores | 0.04 cores | 0.05 cores | 0.00 cores | 0.04 cores | 0.05 cores | — |
| Generator CPU | 0.12 cores | 0.12 cores | 0.13 cores | 0.13 cores | 0.14 cores | 0.13 cores | 0.03 cores | 0.12 cores | 0.17 cores | — |
| Idle RSS | 24.4 MiB | 23.9 MiB | 8.1 MiB | 118.2 MiB | 270.0 MiB | 294.6 MiB | 135.2 MiB | 95.0 MiB | 42.1 MiB | — |
| Peak RSS | 26.4 MiB | 29.4 MiB | 14.1 MiB | 129.4 MiB | 345.1 MiB | 294.6 MiB | 139.3 MiB | 179.2 MiB | 46.7 MiB | — |
| Ready | 305 ms | 341 ms | 86 ms | 88 ms | 3546 ms | 7884 ms | 4883 ms | 213 ms | 15931 ms | — |

OmniRoute errors across repetitions: not_sent 3875, timeout 3625.

Portkey errors across repetitions: reset 1.

## Closed loop, 64 connections (closed-64)

Window 2s warm-up + 5s measure, 3 repetition(s).

| | WowRouter classic | WowRouter virtual | Loopback proxy | Antirion | Bifrost | LiteLLM | OmniRoute | Portkey | Helicone | Direct |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Latency p50 | 31.87 ms | 41.34 ms | 3.15 ms | 3.04 ms | 7.45 ms | 83.53 ms | 0 µs | 20.86 ms | 3.60 ms | 714 µs |
| Latency p99 | 71.35 ms | 71.20 ms | 8.12 ms | 8.37 ms | 32.98 ms | 228.23 ms | 0 µs | 40.65 ms | 8.33 ms | 4.30 ms |
| Latency p99.9 | 88.50 ms | 84.20 ms | 10.49 ms | 18.07 ms | 47.77 ms | 257.10 ms | 0 µs | 46.03 ms | 10.43 ms | 6.46 ms |
| Overhead p50 | 31.11 ms | 40.59 ms | 2.44 ms | 2.29 ms | 6.74 ms | 82.83 ms | — | 20.15 ms | 2.89 ms | — |
| Overhead p99 | 67.05 ms | 66.92 ms | 3.62 ms | 4.08 ms | 28.94 ms | 224.32 ms | — | 36.94 ms | 4.36 ms | — |
| Overhead p99.9 | 81.14 ms | 77.38 ms | 3.43 ms | 10.91 ms | 41.15 ms | 249.30 ms | — | 40.24 ms | 3.65 ms | — |
| Success | 100.00% (9507/9507) | 100.00% (7562/7562) | 100.00% (95934/95934) | 100.00% (94090/94090) | 100.00% (36906/36906) | 100.00% (2992/2992) | 0.00% (0/15) | 100.00% (14171/14171) | 100.00% (84360/84360) | 100.00% (313618/313618) |
| Success rate | 1901 req/s | 1512 req/s | 19187 req/s | 18818 req/s | 7381 req/s | 598 req/s | 0.0 req/s | 2834 req/s | 16872 req/s | 62724 req/s |
| Schedule late | 0.000% | 0.000% | 0.200% | 0.281% | 0.346% | 0.114% | 0.000% | 0.007% | 0.448% | 0.120% |
| CPU per request | 531 µs | 890 µs | 95 µs | 115 µs | 413 µs | 3 µs | 6000 µs | 462 µs | 142 µs | — |
| CPU | 1.01 cores | 1.30 cores | 1.82 cores | 2.18 cores | 3.02 cores | 0.00 cores | 0.01 cores | 1.31 cores | 2.38 cores | — |
| Mock CPU | 0.14 cores | 0.12 cores | 0.44 cores | 0.48 cores | 0.26 cores | 0.06 cores | 0.00 cores | 0.09 cores | 0.37 cores | — |
| Generator CPU | 0.25 cores | 0.21 cores | 1.02 cores | 1.03 cores | 0.62 cores | 0.11 cores | 0.02 cores | 0.26 cores | 0.98 cores | — |
| Idle RSS | 24.3 MiB | 24.0 MiB | 8.1 MiB | 118.5 MiB | 288.2 MiB | 294.7 MiB | 133.3 MiB | 94.7 MiB | 42.3 MiB | — |
| Peak RSS | 27.9 MiB | 31.2 MiB | 18.9 MiB | 267.7 MiB | 560.5 MiB | 294.7 MiB | 133.3 MiB | 226.6 MiB | 56.2 MiB | — |
| Ready | 337 ms | 309 ms | 87 ms | 89 ms | 3636 ms | 8264 ms | 4969 ms | 214 ms | 15938 ms | — |

OmniRoute errors across repetitions: timeout 45.

## Streaming chat at 200 requests per second (stream)

Window 2s warm-up + 5s measure, 3 repetition(s).

| | WowRouter classic | Loopback proxy | Antirion | Bifrost | LiteLLM | OmniRoute | Direct |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Latency p50 | 2.11 ms | 1.01 ms | 1.34 ms | 1.51 ms | 9.89 ms | 0 µs | 889 µs |
| Latency p99 | 3.36 ms | 1.84 ms | 2.24 ms | 2.46 ms | 12.76 ms | 0 µs | 1.58 ms |
| Latency p99.9 | 3.65 ms | 2.16 ms | 2.48 ms | 5.83 ms | 13.81 ms | 0 µs | 1.66 ms |
| TTFT p50 | 1.29 ms | 1.01 ms | 1.34 ms | 1.48 ms | 7.47 ms | 0 µs | 889 µs |
| TTFT p99 | 2.04 ms | 1.84 ms | 2.24 ms | 2.44 ms | 9.50 ms | 0 µs | 1.58 ms |
| TTFT overhead p50 | 430 µs | 134 µs | 409 µs | 590 µs | 6.61 ms | — | — |
| TTFT overhead p99 | 537 µs | 320 µs | 659 µs | 885 µs | 7.94 ms | — | — |
| Overhead p50 | 1.18 ms | 138 µs | 408 µs | 616 µs | 9.03 ms | — | — |
| Overhead p99 | 1.78 ms | 319 µs | 659 µs | 900 µs | 11.20 ms | — | — |
| Overhead p99.9 | 1.99 ms | 328 µs | 749 µs | 4.14 ms | 12.10 ms | — | — |
| Success | 100.00% (1000/1000) | 100.00% (1000/1000) | 100.00% (1000/1000) | 100.00% (1000/1000) | 100.00% (1000/1000) | 0.00% (0/1000) | 100.00% (1000/1000) |
| Schedule late | 9.500% | 8.500% | 8.000% | 9.600% | 6.600% | 43.300% | 10.000% |
| CPU per request | 830 µs | 310 µs | 430 µs | 1070 µs | 0 µs | 410 µs | — |
| CPU | 0.17 cores | 0.06 cores | 0.09 cores | 0.21 cores | 0.00 cores | 0.03 cores | — |
| Mock CPU | 0.03 cores | 0.03 cores | 0.03 cores | 0.03 cores | 0.03 cores | 0.00 cores | — |
| Generator CPU | 0.08 cores | 0.08 cores | 0.08 cores | 0.08 cores | 0.08 cores | 0.05 cores | — |
| Idle RSS | 24.4 MiB | 8.2 MiB | 117.7 MiB | 282.9 MiB | 294.7 MiB | 128.1 MiB | — |
| Peak RSS | 26.0 MiB | 14.0 MiB | 124.9 MiB | 320.0 MiB | 294.7 MiB | 132.1 MiB | — |
| Ready | 336 ms | 86 ms | 91 ms | 3544 ms | 8190 ms | 4947 ms | — |

OmniRoute errors across repetitions: status_200 3000, timeout 3000.

## Simple chat at 1,000 requests per second (chat-1000)

Window 2s warm-up + 5s measure, 3 repetition(s).

| | WowRouter classic | WowRouter virtual | Loopback proxy | Antirion | Bifrost | LiteLLM | OmniRoute | Portkey | Helicone | Direct |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Latency p50 | 1.33 ms | 1.75 ms | 711 µs | 866 µs | 1.09 ms | 4.08 s | 0 µs | 1.34 ms | 889 µs | 630 µs |
| Latency p99 | 3.13 ms | 4.24 ms | 1.46 ms | 1.68 ms | 2.66 ms | 7.58 s | 0 µs | 6.54 ms | 1.70 ms | 1.33 ms |
| Latency p99.9 | 4.30 ms | 5.33 ms | 1.95 ms | 2.04 ms | 6.70 ms | 7.78 s | 0 µs | 13.78 ms | 2.34 ms | 1.51 ms |
| Overhead p50 | 719 µs | 1.12 ms | 87 µs | 239 µs | 450 µs | 4.08 s | — | 727 µs | 269 µs | — |
| Overhead p99 | 1.78 ms | 2.90 ms | 107 µs | 349 µs | 1.30 ms | 7.58 s | — | 5.20 ms | 380 µs | — |
| Overhead p99.9 | 2.67 ms | 3.76 ms | 366 µs | 504 µs | 5.12 ms | 7.78 s | — | 12.19 ms | 678 µs | — |
| Success | 100.00% (5000/5000) | 100.00% (5000/5000) | 100.00% (5000/5000) | 100.00% (5000/5000) | 100.00% (5000/5000) | 100.00% (5000/5000) | 0.00% (0/5000) | 100.00% (5000/5000) | 100.00% (5000/5000) | 100.00% (5000/5000) |
| Schedule late | 5.240% | 4.180% | 6.100% | 6.240% | 6.240% | 100.000% | 100.000% | 6.260% | 6.600% | 4.340% |
| CPU per request | 580 µs | 824 µs | 180 µs | 252 µs | 690 µs | 2 µs | 996 µs | 926 µs | 312 µs | — |
| CPU | 0.58 cores | 0.82 cores | 0.18 cores | 0.25 cores | 0.69 cores | 0.00 cores | 0.02 cores | 0.93 cores | 0.31 cores | — |
| Mock CPU | 0.08 cores | 0.08 cores | 0.07 cores | 0.07 cores | 0.08 cores | 0.05 cores | 0.00 cores | 0.06 cores | 0.08 cores | — |
| Generator CPU | 0.20 cores | 0.20 cores | 0.20 cores | 0.20 cores | 0.22 cores | 0.10 cores | 0.03 cores | 0.17 cores | 0.28 cores | — |
| Idle RSS | 24.0 MiB | 24.0 MiB | 8.1 MiB | 116.9 MiB | 265.6 MiB | 294.7 MiB | 135.0 MiB | 93.2 MiB | 42.3 MiB | — |
| Peak RSS | 26.4 MiB | 29.7 MiB | 14.2 MiB | 135.7 MiB | 374.7 MiB | 294.8 MiB | 135.5 MiB | 201.4 MiB | 47.1 MiB | — |
| Ready | 338 ms | 341 ms | 87 ms | 94 ms | 3668 ms | 8479 ms | 5008 ms | 213 ms | 15940 ms | — |

OmniRoute errors across repetitions: not_sent 14320, timeout 680.

## Simple chat at 5,000 requests per second (chat-5000)

Window 2s warm-up + 3s measure, 3 repetition(s).

| | WowRouter classic | WowRouter virtual | Loopback proxy | Antirion | Bifrost | LiteLLM | OmniRoute | Portkey | Helicone | Direct |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Latency p50 | 5.55 s | 7.37 s | 601 µs | 408 µs | 940 µs | 9.12 s | 0 µs | 4.35 s | 428 µs | 577 µs |
| Latency p99 | 7.87 s | 8.89 s | 1.80 ms | 1.64 ms | 21.10 ms | 9.39 s | 0 µs | 6.79 s | 1.72 ms | 1.41 ms |
| Latency p99.9 | 7.96 s | 9.08 s | 2.54 ms | 2.09 ms | 32.40 ms | 9.40 s | 0 µs | 8.93 s | 2.09 ms | 1.99 ms |
| Overhead p50 | 5.55 s | 7.37 s | 18 µs | -166 µs | 358 µs | 9.11 s | — | 4.35 s | -151 µs | — |
| Overhead p99 | 7.87 s | 8.89 s | 370 µs | 258 µs | 19.68 ms | 9.39 s | — | 6.79 s | 353 µs | — |
| Overhead p99.9 | 7.96 s | 9.07 s | 627 µs | 235 µs | 30.42 ms | 9.39 s | — | 8.93 s | 386 µs | — |
| Success | 100.00% (15000/15000) | 68.84% (10326/15000) | 100.00% (15000/15000) | 100.00% (15000/15000) | 100.00% (15000/15000) | 9.51% (1427/15000) | 0.00% (0/15000) | 100.00% (15000/15000) | 100.00% (15000/15000) | 100.00% (15000/15000) |
| Schedule late | 100.000% | 100.000% | 10.413% | 0.827% | 7.260% | 100.000% | 100.000% | 100.000% | 0.053% | 9.987% |
| CPU per request | 560 µs | 908 µs | 107 µs | 202 µs | 493 µs | 7 µs | 604 µs | 556 µs | 239 µs | — |
| CPU | 0.99 cores | 1.32 cores | 0.53 cores | 1.01 cores | 2.46 cores | 0.00 cores | 0.03 cores | 1.17 cores | 1.19 cores | — |
| Mock CPU | 0.15 cores | 0.12 cores | 0.21 cores | 0.28 cores | 0.26 cores | 0.06 cores | 0.00 cores | 0.08 cores | 0.27 cores | — |
| Generator CPU | 0.25 cores | 0.23 cores | 0.53 cores | 0.60 cores | 0.58 cores | 0.10 cores | 0.03 cores | 0.23 cores | 0.95 cores | — |
| Idle RSS | 24.2 MiB | 24.1 MiB | 8.2 MiB | 118.3 MiB | 273.0 MiB | 294.7 MiB | 132.3 MiB | 93.3 MiB | 42.2 MiB | — |
| Peak RSS | 82.8 MiB | 92.4 MiB | 14.7 MiB | 170.2 MiB | 552.6 MiB | 294.8 MiB | 136.7 MiB | 286.5 MiB | 48.5 MiB | — |
| Ready | 337 ms | 313 ms | 87 ms | 93 ms | 3637 ms | 8392 ms | 4946 ms | 213 ms | 15951 ms | — |

WowRouter classic errors across repetitions: not_sent 762.

WowRouter virtual errors across repetitions: not_sent 13905.

LiteLLM errors across repetitions: not_sent 40652.

OmniRoute errors across repetitions: not_sent 43721, timeout 1279.

## Unknown router key at 2,000 requests per second (reject-key)

Window 1s warm-up + 4s measure, 3 repetition(s).

| | WowRouter classic | WowRouter virtual | Antirion | Bifrost | LiteLLM | OmniRoute |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Latency p50 | 605 µs | 607 µs | 617 µs | 748 µs | 1.18 s | 2.49 s |
| Latency p99 | 1.42 ms | 1.49 ms | 1.45 ms | 2.80 ms | 1.53 s | 6.14 s |
| Latency p99.9 | 1.81 ms | 1.89 ms | 2.07 ms | 8.51 ms | 1.57 s | 8.67 s |
| Overhead p50 | — | — | — | — | — | — |
| Overhead p99 | — | — | — | — | — | — |
| Overhead p99.9 | — | — | — | — | — | — |
| Success | 100.00% (8000/8000) | 100.00% (8000/8000) | 100.00% (8000/8000) | 100.00% (8000/8000) | 100.00% (8000/8000) | 99.88% (7990/8000) |
| Schedule late | 6.813% | 5.737% | 4.938% | 11.725% | 100.000% | 100.000% |
| CPU per request | 110 µs | 155 µs | 98 µs | 320 µs | 0 µs | 8 µs |
| CPU | 0.22 cores | 0.31 cores | 0.19 cores | 0.64 cores | 0.00 cores | 0.01 cores |
| Mock CPU | 0.00 cores | 0.00 cores | 0.00 cores | 0.00 cores | 0.00 cores | 0.00 cores |
| Generator CPU | 0.30 cores | 0.33 cores | 0.50 cores | 0.35 cores | 0.32 cores | 0.15 cores |
| Idle RSS | 24.2 MiB | 24.0 MiB | 118.1 MiB | 286.6 MiB | 294.7 MiB | 132.3 MiB |
| Peak RSS | 25.0 MiB | 25.3 MiB | 120.3 MiB | 309.0 MiB | 294.7 MiB | 132.3 MiB |
| Ready | 338 ms | 336 ms | 97 ms | 3550 ms | 7922 ms | 4872 ms |

OmniRoute errors across repetitions: timeout 61.

## Unknown model at 2,000 requests per second (reject-model)

Window 1s warm-up + 4s measure, 3 repetition(s).

| | WowRouter classic | WowRouter virtual | Antirion | Bifrost | LiteLLM |
| --- | ---: | ---: | ---: | ---: | ---: |
| Latency p50 | 1.02 ms | 2.05 s | 586 µs | 768 µs | 5.43 s |
| Latency p99 | 3.66 ms | 3.54 s | 1.43 ms | 2.50 ms | 7.74 s |
| Latency p99.9 | 5.34 ms | 3.99 s | 1.93 ms | 6.27 ms | 7.78 s |
| Overhead p50 | — | — | — | — | — |
| Overhead p99 | — | — | — | — | — |
| Overhead p99.9 | — | — | — | — | — |
| Success | 100.00% (8000/8000) | 100.00% (8000/8000) | 100.00% (8000/8000) | 100.00% (8000/8000) | 100.00% (8000/8000) |
| Schedule late | 6.062% | 100.000% | 5.938% | 12.475% | 100.000% |
| CPU per request | 281 µs | 704 µs | 86 µs | 349 µs | 1 µs |
| CPU | 0.56 cores | 0.85 cores | 0.17 cores | 0.70 cores | 0.00 cores |
| Mock CPU | 0.00 cores | 0.00 cores | 0.00 cores | 0.00 cores | 0.00 cores |
| Generator CPU | 0.33 cores | 0.18 cores | 0.30 cores | 0.36 cores | 0.19 cores |
| Idle RSS | 24.4 MiB | 23.9 MiB | 120.8 MiB | 279.9 MiB | 294.8 MiB |
| Peak RSS | 26.9 MiB | 77.0 MiB | 123.4 MiB | 317.3 MiB | 294.8 MiB |
| Ready | 335 ms | 338 ms | 88 ms | 3542 ms | 7991 ms |

## Idle memory (idle)

3 repetition(s), sampled after the process is healthy and, for WowRouter, after the provider and key are saved. No chat load.

| | WowRouter classic | WowRouter virtual | Loopback proxy | Antirion | Bifrost | LiteLLM | OmniRoute | Portkey | Helicone |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Ready | 335 ms | 344 ms | 86 ms | 93 ms | 3601 ms | 8121 ms | 4907 ms | 184 ms | 15934 ms |
| Idle RSS | 24.2 MiB | 23.9 MiB | 8.1 MiB | 118.1 MiB | 271.3 MiB | 294.8 MiB | 130.0 MiB | 94.9 MiB | 42.4 MiB |

## Open-loop saturation, simple chat (ladder)

Each gateway has its own ladder. A step is one repetition, 1s warm-up and 3s measure. That gateway's ladder stops at its first miss.

### WowRouter classic

| Offered | Success | p50 | p99 | Overhead p50 | Overhead p99 | Direct p99 | Result |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 100 rps | 100.00% (300/300) | 2.39 ms | 3.63 ms | 1.52 ms | 2.00 ms | 1.63 ms | pass |
| 250 rps | 100.00% (750/750) | 1.95 ms | 3.25 ms | 1.08 ms | 1.84 ms | 1.41 ms | pass |
| 500 rps | 100.00% (1500/1500) | 1.55 ms | 2.72 ms | 777 µs | 1.30 ms | 1.42 ms | pass |
| 1000 rps | 100.00% (3000/3000) | 1.28 ms | 2.99 ms | 650 µs | 1.66 ms | 1.33 ms | pass |
| 2000 rps | 100.00% (6000/6000) | 93.48 ms | 359.19 ms | 92.90 ms | 357.85 ms | 1.34 ms | stop |

Highest passing step: **1000 rps**.

Stop note: 2000 rps: p99 overhead was above 5ms.

### WowRouter virtual

| Offered | Success | p50 | p99 | Overhead p50 | Overhead p99 | Direct p99 | Result |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 100 rps | 100.00% (300/300) | 3.51 ms | 4.33 ms | 2.60 ms | 2.77 ms | 1.56 ms | pass |
| 250 rps | 100.00% (750/750) | 2.20 ms | 3.89 ms | 1.33 ms | 2.31 ms | 1.58 ms | pass |
| 500 rps | 100.00% (1500/1500) | 2.00 ms | 3.54 ms | 1.23 ms | 2.13 ms | 1.41 ms | pass |
| 1000 rps | 100.00% (3000/3000) | 1.75 ms | 3.80 ms | 1.11 ms | 2.47 ms | 1.33 ms | pass |
| 2000 rps | 100.00% (6000/6000) | 1.08 s | 1.58 s | 1.08 s | 1.58 s | 1.34 ms | stop |

Highest passing step: **1000 rps**.

Stop note: 2000 rps: p99 overhead was above 5ms.

### Loopback proxy

| Offered | Success | p50 | p99 | Overhead p50 | Overhead p99 | Direct p99 | Result |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 100 rps | 100.00% (300/300) | 1.06 ms | 1.96 ms | 127 µs | 394 µs | 1.57 ms | pass |
| 250 rps | 100.00% (750/750) | 970 µs | 1.59 ms | -11 µs | -13 µs | 1.61 ms | pass |
| 500 rps | 100.00% (1500/1500) | 844 µs | 1.53 ms | 86 µs | 158 µs | 1.37 ms | pass |
| 1000 rps | 100.00% (3000/3000) | 709 µs | 1.45 ms | 65 µs | 110 µs | 1.34 ms | pass |
| 2000 rps | 100.00% (6000/6000) | 637 µs | 1.46 ms | 53 µs | 132 µs | 1.33 ms | pass |
| 4000 rps | 100.00% (12000/12000) | 649 µs | 1.61 ms | 62 µs | 254 µs | 1.36 ms | pass |
| 8000 rps | 100.00% (24000/24000) | 187 µs | 1.62 ms | -382 µs | 149 µs | 1.47 ms | pass |

Highest passing step: **8000 rps**.

Stop note: every step through 8000 rps passed; the ladder does not go higher.

### Antirion

| Offered | Success | p50 | p99 | Overhead p50 | Overhead p99 | Direct p99 | Result |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 100 rps | 100.00% (300/300) | 1.32 ms | 2.40 ms | 420 µs | 801 µs | 1.60 ms | pass |
| 250 rps | 100.00% (750/750) | 1.19 ms | 1.86 ms | 225 µs | 297 µs | 1.56 ms | pass |
| 500 rps | 100.00% (1500/1500) | 1.05 ms | 1.85 ms | 328 µs | 441 µs | 1.41 ms | pass |
| 1000 rps | 100.00% (3000/3000) | 894 µs | 1.73 ms | 277 µs | 391 µs | 1.34 ms | pass |
| 2000 rps | 100.00% (6000/6000) | 759 µs | 1.75 ms | 190 µs | 428 µs | 1.32 ms | pass |
| 4000 rps | 100.00% (12000/12000) | 459 µs | 1.72 ms | -138 µs | 289 µs | 1.43 ms | pass |
| 8000 rps | 100.00% (24000/24000) | 469 µs | 4.43 ms | -99 µs | 2.85 ms | 1.57 ms | pass |

Highest passing step: **8000 rps**.

Stop note: every step through 8000 rps passed; the ladder does not go higher.

### Bifrost

| Offered | Success | p50 | p99 | Overhead p50 | Overhead p99 | Direct p99 | Result |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 100 rps | 100.00% (300/300) | 1.55 ms | 2.56 ms | 613 µs | 929 µs | 1.63 ms | pass |
| 250 rps | 100.00% (750/750) | 1.67 ms | 9.72 ms | 701 µs | 8.10 ms | 1.62 ms | stop |

Highest passing step: **100 rps**.

Stop note: 250 rps: p99 overhead was above 5ms.

### LiteLLM

| Offered | Success | p50 | p99 | Overhead p50 | Overhead p99 | Direct p99 | Result |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 100 rps | 100.00% (300/300) | 7.39 ms | 8.12 ms | 6.45 ms | 6.44 ms | 1.68 ms | stop |

No step passed.

Stop note: 100 rps: p99 overhead was above 5ms.

### OmniRoute

| Offered | Success | p50 | p99 | Overhead p50 | Overhead p99 | Direct p99 | Result |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 100 rps | 0.00% (0/300) | 0 µs | 0 µs | — | — | 1.61 ms | stop |

No step passed.

Stop note: 100 rps: gateway run had no successful requests to compare.

### Portkey

| Offered | Success | p50 | p99 | Overhead p50 | Overhead p99 | Direct p99 | Result |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 100 rps | 100.00% (300/300) | 2.35 ms | 3.56 ms | 1.44 ms | 1.92 ms | 1.64 ms | pass |
| 250 rps | 100.00% (750/750) | 2.06 ms | 4.48 ms | 1.18 ms | 2.97 ms | 1.51 ms | pass |
| 500 rps | 100.00% (1500/1500) | 1.99 ms | 305.48 ms | 1.24 ms | 304.02 ms | 1.47 ms | stop |

Highest passing step: **250 rps**.

Stop note: 500 rps: p99 overhead was above 5ms.

### Helicone

| Offered | Success | p50 | p99 | Overhead p50 | Overhead p99 | Direct p99 | Result |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 100 rps | 100.00% (300/300) | 1.34 ms | 2.44 ms | 449 µs | 913 µs | 1.53 ms | pass |
| 250 rps | 100.00% (750/750) | 1.14 ms | 2.87 ms | 323 µs | 1.43 ms | 1.44 ms | pass |
| 500 rps | 100.00% (1500/1500) | 1.08 ms | 1.98 ms | 327 µs | 563 µs | 1.41 ms | pass |
| 1000 rps | 100.00% (3000/3000) | 888 µs | 1.77 ms | 259 µs | 424 µs | 1.34 ms | pass |
| 2000 rps | 100.00% (6000/6000) | 832 µs | 1.82 ms | 254 µs | 497 µs | 1.32 ms | pass |
| 4000 rps | 100.00% (12000/12000) | 373 µs | 1.65 ms | -215 µs | 294 µs | 1.35 ms | pass |
| 8000 rps | 100.00% (24000/24000) | 554 µs | 2.81 ms | -13 µs | 1.31 ms | 1.50 ms | pass |

Highest passing step: **8000 rps**.

Stop note: every step through 8000 rps passed; the ladder does not go higher.

## Comparison

Medians. Overhead is against that repetition's own direct run. A dash means that cell was not run for that target, or the target produced no successful samples to score.

| Gateway | Overhead p50 | Overhead p99 | Latency p50 | Latency p99 | CPU / request | Peak RSS | Idle RSS | 64-conn req/s | 64-conn p50 | Highest sustained | Unknown key p50 | Unknown model p50 | Errors at 500 rps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| WowRouter classic | 673 µs | 1.30 ms | 1.42 ms | 2.66 ms | 632 µs | 26.4 MiB | 24.2 MiB | 1901 req/s | 31.87 ms | 1000 rps | 605 µs | 1.02 ms | 0 |
| WowRouter virtual | 1.09 ms | 2.06 ms | 1.83 ms | 3.45 ms | 856 µs | 29.4 MiB | 23.9 MiB | 1512 req/s | 41.34 ms | 1000 rps | 607 µs | 2.05 s | 0 |
| Loopback proxy | 65 µs | 207 µs | 852 µs | 1.59 ms | 224 µs | 14.1 MiB | 8.1 MiB | 19187 req/s | 3.15 ms | 8000 rps | — | — | 0 |
| Antirion | 254 µs | 400 µs | 1.02 ms | 1.79 ms | 292 µs | 129.4 MiB | 118.1 MiB | 18818 req/s | 3.04 ms | 8000 rps | 617 µs | 586 µs | 0 |
| Bifrost | 423 µs | 532 µs | 1.18 ms | 1.91 ms | 764 µs | 345.1 MiB | 271.3 MiB | 7381 req/s | 7.45 ms | 100 rps | 748 µs | 768 µs | 0 |
| LiteLLM | 52.69 ms | 311.26 ms | 53.44 ms | 312.65 ms | 0 µs | 294.6 MiB | 294.8 MiB | 598 req/s | 83.53 ms | — | 1.18 s | 5.43 s | 0 |
| OmniRoute | — | — | — | — | 468 µs | 139.3 MiB | 130.0 MiB | 0.0 req/s | — | — | 2.49 s | — | 2500 |
| Portkey | 831 µs | 2.41 ms | 1.59 ms | 3.79 ms | 1240 µs | 179.2 MiB | 94.9 MiB | 2834 req/s | 20.86 ms | 250 rps | — | — | 0 |
| Helicone | 369 µs | 652 µs | 1.08 ms | 2.02 ms | 384 µs | 46.7 MiB | 42.4 MiB | 16872 req/s | 3.60 ms | 8000 rps | — | — | 0 |

LiteLLM's CPU counter on the sampled process tree stayed at 0 during the measure windows. That 0 µs is not a measurement of zero work: the worker CPU did not show up on the process the harness sampled. Helicone's ready time is about 16s because the first health probe used port 19480, which this build does not listen on; the process then came up on port 8080, and the latency figures are from that process.

## Start and sanity failures

- stream / WowRouter virtual: sanity check expected one 200 and got success=0 errors=map[status_200:1] statuses=map[status_200:1]
- stream / Portkey: sanity check expected one 200 and got success=0 errors=map[status_500:1] statuses=map[status_500:1]
⠋ Starting AI Gateway...
⠙ Starting AI Gateway...
⠹ Starting AI Gateway...
⠸ Starting AI Gateway...
⠼ Starting AI Gateway...
⠴ Starting AI Gateway...tryTargetsRecursively error:  immutable undefined TypeError: immutable     at appendHeader (node:internal/deps/undici/undici:9104:15)     at _Headers.append (node:internal/deps/undici/undici:9307:16)     at ru.updateHeaders (file:///workspace/bench/.cache/npm/node_modules/@portkey-ai/gateway/build/start-server.js:2:434559)     at ru.create (file:///workspace/bench/.cache/npm/node_modules/@portkey-ai/gateway/build/start-server.js:2:434
- stream / Helicone: sanity check expected one 200 and got success=0 errors=map[status_200:1] statuses=map[status_200:1]
- stream / WowRouter virtual: sanity check expected one 200 and got success=0 errors=map[status_200:1] statuses=map[status_200:1]
- stream / Portkey: sanity check expected one 200 and got success=0 errors=map[status_500:1] statuses=map[status_500:1]
⠋ Starting AI Gateway...
⠙ Starting AI Gateway...
⠹ Starting AI Gateway...
⠸ Starting AI Gateway...
⠼ Starting AI Gateway...
⠴ Starting AI Gateway...tryTargetsRecursively error:  immutable undefined TypeError: immutable     at appendHeader (node:internal/deps/undici/undici:9104:15)     at _Headers.append (node:internal/deps/undici/undici:9307:16)     at ru.updateHeaders (file:///workspace/bench/.cache/npm/node_modules/@portkey-ai/gateway/build/start-server.js:2:434559)     at ru.create (file:///workspace/bench/.cache/npm/node_modules/@portkey-ai/gateway/build/start-server.js:2:434
- stream / Helicone: sanity check expected one 200 and got success=0 errors=map[status_200:1] statuses=map[status_200:1]
- stream / WowRouter virtual: sanity check expected one 200 and got success=0 errors=map[status_200:1] statuses=map[status_200:1]
- stream / Portkey: sanity check expected one 200 and got success=0 errors=map[status_500:1] statuses=map[status_500:1]
⠋ Starting AI Gateway...
⠙ Starting AI Gateway...
⠹ Starting AI Gateway...
⠸ Starting AI Gateway...
⠼ Starting AI Gateway...
⠴ Starting AI Gateway...tryTargetsRecursively error:  immutable undefined TypeError: immutable     at appendHeader (node:internal/deps/undici/undici:9104:15)     at _Headers.append (node:internal/deps/undici/undici:9307:16)     at ru.updateHeaders (file:///workspace/bench/.cache/npm/node_modules/@portkey-ai/gateway/build/start-server.js:2:434559)     at ru.create (file:///workspace/bench/.cache/npm/node_modules/@portkey-ai/gateway/build/start-server.js:2:434
- stream / Helicone: sanity check expected one 200 and got success=0 errors=map[status_200:1] statuses=map[status_200:1]

