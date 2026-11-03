# OmniRoute dashboard parity

This table lists every page under OmniRoute `src/app/(dashboard)/dashboard/**/page.tsx` on the cheaper-inference/OmniRoute tree, plus the sidebar groups in `src/shared/constants/sidebarVisibility/sections.ts`. WowRouter reimplements the behavior. It does not copy OmniRoute's files.

Count: **124** dashboard page routes. **111** have a working WowRouter page or a section of one. **13** stay skipped. The reasons are in the last section. The panel password is still off until Settings turns it on.

WowRouter groups the pages so the sidebar stays short. A row that says "section of" is the same feature, reached from that page.

| OmniRoute route | WowRouter | What it does here |
| --- | --- | --- |
| `/dashboard` | `/` | Overview counts |
| `/dashboard/endpoint` | `/endpoints` | Live route list for chat, messages, responses, files, batches, MCP, and A2A |
| `/dashboard/api-endpoints` | `/endpoints` | Same list |
| `/dashboard/api-manager` | `/keys` | Router keys, prefixes, monthly caps |
| `/dashboard/api-manager/[id]/access` | `/keys` | One key's budget is edited on the key row |
| `/dashboard/api-manager/routing` | `/routing` | Combos and auto profiles |
| `/dashboard/providers` | `/providers` | Keys, base URLs, accounts |
| `/dashboard/providers/new` | `/providers` | Providers come from the catalog. There is no blank custom row |
| `/dashboard/providers/[id]` | `/providers/:slug` | Enable, test, models, device sign-in, token paste |
| `/dashboard/models` | `/models` | Cross-provider search |
| `/dashboard/combos` | `/routing` | Named combos and strategies, including quota strategies |
| `/dashboard/combos/[id]` | `/routing` | Edit the same combo |
| `/dashboard/combos/live` | `/routing` and `/activity` | The route note on a call shows which step ran |
| `/dashboard/combos/playground` | `/playground` | Chat against a combo id |
| `/dashboard/auto-combo` | `/routing` | `auto`, `auto/cheap`, `auto/fast`, `auto/coding` |
| `/dashboard/quota` | `/quota` | Saved rate-limit headers |
| `/dashboard/costs/quota-share` | `/quota` and `/routing` | Quota-share is a combo strategy that reads those slots |
| `/dashboard/context` | `/compression` | Index of the local compression modes |
| `/dashboard/context/settings` | `/settings` and `/compression` | Compression mode, off by default |
| `/dashboard/context/combos` | `/compression` | One global mode. Per-combo compressors are not separate pipelines |
| `/dashboard/context/caveman` | `/compression` mode `caveman` | Drops filler words |
| `/dashboard/context/rtk` | `/compression` mode `rtk` | Drops shell prompt lines |
| `/dashboard/context/headroom` | `/compression` mode `headroom` | Keeps the first 4000 characters |
| `/dashboard/context/session-dedup` | `/compression` mode `dedup` | Drops repeated lines |
| `/dashboard/context/ccr` | `/compression` mode `terse` | Short local rewrite. No code-compression model is bundled |
| `/dashboard/context/lite` | `/compression` mode `light` | Squeezes whitespace |
| `/dashboard/context/aggressive` | `/compression` mode `terse` | Caveman plus a length cap |
| `/dashboard/context/ultra` | `/compression` mode `ultra` | Shorter cap |
| `/dashboard/context/llmlingua` | `/compression` | Not bundled. LLMLingua needs a downloaded model |
| `/dashboard/context/omniglyph` | `/compression` | Not bundled. No glyph encoder ships with WowRouter |
| `/dashboard/compression` | `/compression` | Preview any bundled mode |
| `/dashboard/compression/studio` | `/compression` | The preview is the studio |
| `/dashboard/compression/exclusions` | `/compression` | Tool calls and non-text parts are left unchanged |
| `/dashboard/compression/live` | `/activity` | A compressed call is still a normal activity row |
| `/dashboard/cli-code` | `/clients` | Copy-paste and confirmed config writes |
| `/dashboard/cli-code/[id]` | `/clients` | One client card |
| `/dashboard/cli-agents` | `/agents` | A note only. The shell is not launched |
| `/dashboard/cli-agents/[id]` | `/agents` | Same note |
| `/dashboard/acp-agents` | `/agents` kind `acp` | Record only. Private ACP sockets are not implemented |
| `/dashboard/cloud-agents` | `/agents` and providers Jules, Devin, Codex Cloud | A chat call opens a session when that provider is on |
| `/dashboard/conductor` | `/routing` | Combo order is the conductor. It does not spawn processes |
| `/dashboard/orchestration` | `/routing` | Same |
| `/dashboard/tools/agent-bridge` | `/agents` | Notes, not a process bridge |
| `/dashboard/discovery` | `/models` and `POST /v1/models/query` | Catalog search |
| `/dashboard/webhooks` | `/webhooks` | HTTPS POST after each stored call, HMAC secret encrypted at rest |
| `/dashboard/log-export` | Activity **Export CSV** | `GET /api/activity/export` |
| `/dashboard/analytics` | `/usage` and `/status` | Spend, errors, and calls by provider |
| `/dashboard/analytics/combo-health` | `/status` | Error counts by provider |
| `/dashboard/analytics/utilization` | `/status` | Same counts |
| `/dashboard/analytics/compression` | `/compression` | Before and after sizes on the preview |
| `/dashboard/analytics/search` | `/search` | Search-kind models |
| `/dashboard/analytics/evals` | `/evals` | Prompt plus expected substring, run through the router |
| `/dashboard/provider-stats` | `/status` | Calls and errors by provider slug |
| `/dashboard/activity` | `/activity` | Request log |
| `/dashboard/logs` | `/activity` | Same log |
| `/dashboard/logs/proxy` | `/activity` | Upstream status and route note |
| `/dashboard/logs/timeline` | `/activity` | Newest first |
| `/dashboard/logs/activity` | `/activity` | Same |
| `/dashboard/conversations` | `/playground` | Chats stay in this browser |
| `/dashboard/logs/console` | `/console` | Webhook, cache, and guard events |
| `/dashboard/health` | `/status` | Uptime, memory, data directory. `GET /health` remains the process check |
| `/dashboard/runtime` | `/status` | Go version, listen address, data directory |
| `/dashboard/resilience/connections` | `/providers` | Per-provider accounts and enable switch |
| `/dashboard/resilience/cooldowns` | `/quota` | Cooldown timestamp from rate-limit headers |
| `/dashboard/costs` | `/costs` | Token price times recorded tokens |
| `/dashboard/costs/pricing` | `/costs/pricing` | Catalog USD per million |
| `/dashboard/costs/teams` | `/costs/teams` | Shared monthly cap across router keys |
| `/dashboard/costs/budget` | `/keys` and `/limits` | Per-key monthly cap and optional RPM |
| `/dashboard/free-tiers` | `/costs/free` | Catalog rows marked free |
| `/dashboard/free-provider-rankings` | `/costs/free` | The list is the catalog order, not a remote ranking |
| `/dashboard/audit` | `/audit` | Filter MCP, A2A, eval, and batch |
| `/dashboard/audit/mcp` | `/audit` source MCP | |
| `/dashboard/audit/a2a` | `/audit` source A2A | |
| `/dashboard/translator` | `/translator` | OpenAI and Anthropic text bodies, local only |
| `/dashboard/playground` | `/playground` | Chat, with media from `/media` |
| `/dashboard/search-tools` | `/search` | Search-kind models |
| `/dashboard/mcp` | `/endpoints` | `POST /mcp` is on the route list |
| `/dashboard/memory` | `/memory` | Notes, off until Settings enables them |
| `/dashboard/agent-skills` | `/skills` | Saved instructions, not executable code |
| `/dashboard/omni-skills` | `/skills` | Same store |
| `/dashboard/a2a` | `/endpoints` | `POST /a2a` and the agent card |
| `/dashboard/chaos` | `/status/chaos` | Off by default. Delay or reject before the upstream call |
| `/dashboard/cache` | `/cache` | Count, TTL, clear |
| `/dashboard/cache/media` | `/media` | Image prompt against an image model |
| `/dashboard/batch` | `/batches` | Jobs from `POST /v1/batches` |
| `/dashboard/batch/files` | `/batches` | Files from `POST /v1/files` |
| `/dashboard/settings` | `/settings` | |
| `/dashboard/settings/general` | `/settings` | Data directory and listen address |
| `/dashboard/settings/appearance` | Header theme toggle and `/settings` | Light or dark, in this browser |
| `/dashboard/settings/ai` | `/settings` | Compression, cache, memory |
| `/dashboard/settings/routing` | `/routing` | |
| `/dashboard/settings/resilience` | `/quota` | Cooldown from upstream headers |
| `/dashboard/settings/advanced` | `/status/proxy` | Optional outbound proxy |
| `/dashboard/settings/security` | `/settings` | Optional password and OIDC, both off by default |
| `/dashboard/settings/access-tokens` | `/keys` | Router keys. Panel sessions are the login cookie |
| `/dashboard/settings/feature-flags` | `/settings` | The helper toggles |
| `/dashboard/settings/cache` | `/cache` and `/settings` | |
| `/dashboard/settings/sidebar` | `/settings` Sidebar | Hide nav items in this browser. Settings stays |
| `/dashboard/settings/modality-bridge` | `/media` and chat errors | Image models stay on the media path. Chat refuses the wrong kind |
| `/dashboard/settings/pricing` | `/costs/pricing` | Catalog prices |
| `/dashboard/changelog` | `/changelog` | Renders `CHANGELOG.md` |
| `/dashboard/onboarding` | `/onboarding` | Live checks against this database |
| `/dashboard/usage` | `/usage` | Calls by model |
| `/dashboard/limits` | `/limits` | Requests per minute, plus key budgets |
| `/dashboard/system/proxy` | `/status/proxy` | Outbound proxy for provider calls |
| `/dashboard/media-providers` | `/providers` category filter | Media providers are catalog rows |
| `/dashboard/media-providers/[kind]` | `/media` | Image models you can call |
| `/dashboard/media-providers/[kind]/[id]` | `/providers/:slug` | |
| `/dashboard/profile` | `/usage` | Local counts only |
| `/dashboard/tokens` | `/keys` | |
| `/dashboard/providers/services` | skipped | Embedding another app would be an open proxy. `/services` stores a bookmark and opens it directly |
| `/dashboard/tools/traffic-inspector` | `/activity/:id` | Stored request JSON. No packet capture |
| `/dashboard/system/mitm-proxy` | skipped | TLS interception. See below |
| `/dashboard/system/1proxy` | skipped | A second proxy in front of arbitrary traffic |
| `/dashboard/plugins` | skipped | Loading plugin code |
| `/dashboard/plugins/[name]/config` | skipped | Same |
| `/dashboard/radar` | skipped | Remote offer and intel feeds |
| `/dashboard/radar/combos` | skipped | Same |
| `/dashboard/radar/intel` | skipped | Same |
| `/dashboard/radar/offers` | skipped | Same |
| `/dashboard/radar/setup` | skipped | Same |
| `/dashboard/leaderboard` | skipped | Would upload usage |
| `/dashboard/gamification/admin` | skipped | Same |
| `/dashboard/relay` | skipped | Relaying arbitrary third-party traffic |

Sidebar groups in OmniRoute (Home, OmniProxy, Compression, Tools, Integrations, Proxy, Analytics, Logs, System, Costs, Audit, Devtools, Agentic, Gamification, Media, Batch, Configuration, Help) are the sections Router, Work, Access, Observe, and System in the WowRouter sidebar.

## Skipped, and why

These are the only gaps. Each one is unsafe or would send data off this computer. A page that merely is not a separate URL is not a gap. It is linked from the page in the table.

1. **TLS interception** (`/dashboard/system/mitm-proxy`). Installing a local certificate authority to read other programs' HTTPS is not an endpoint the user points at a client. It stays out.
2. **Traffic capture beyond stored requests.** Activity already keeps the request body for a call the router handled. Sniffing other programs is the same risk as MITM.
3. **Embedded service reverse proxy** (`/dashboard/providers/services`). Proxying another app's UI through WowRouter is an open proxy. Bookmarks open the URL in the browser instead.
4. **1Proxy / relay.** A general relay in front of arbitrary hosts is the same open-proxy risk.
5. **Plugin code.** WowRouter does not load or run third-party code. MCP, A2A, webhooks, and skills are the extension points, and skills are text.
6. **Radar, leaderboard, and gamification admin.** Those flows collect or publish usage outside this machine. Usage, costs, and keys stay local.
7. **LLMLingua and Omniglyph.** They need model weights this repo does not ship. The compression page says so and previews the local modes.
8. **Shell launch for CLI, ACP, and conductor.** Starting an arbitrary binary, or speaking a private socket that binary owns, is not a stable API. The Agents page can record the name. Cloud agents with an HTTP API are real providers.
