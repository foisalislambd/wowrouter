# Panel pages

The panel is the local control surface for one OpenAI- and Anthropic-compatible endpoint. A coding agent uses one router key. Provider keys stay on this computer. The password stays off until Settings turns it on.

Shared pieces (`PageHeader`, tabs, empty and loading states, confirm dialogs, toasts, copy buttons) keep the pages in one layout. The sidebar stays in five groups. Thin pages are tabs of a parent so the list stays short. Old URLs still open the right tab.

| Page | Purpose | What you can do |
| --- | --- | --- |
| Overview `/` | See whether the router is ready today | Today's requests, cost, errors, and latency; 7-day chart; setup steps; provider health; top models; copy the endpoint. `/onboarding` opens this page |
| Providers `/providers` | Connect upstream accounts | Search, category chips, ready or needs-setup filter, infinite list. A provider page tests the connection, shows stored-call latency, and links to docs |
| Models `/models` | Find a model id | Search, kind filter, sort by name, price, or provider, and page through the catalog. `/search` opens the search kind |
| Routing `/routing` | Decide which model runs | Auto profiles, combos with duplicate and delete, quota tab at `/quota` |
| Endpoints `/endpoints` | Copy the local routes | Route list, and a translator tab at `/translator` for OpenAI and Anthropic JSON |
| Clients `/clients` | Point a coding agent here | Copy the base URL, snippets, and confirmed config writes with backup and restore |
| Playground `/playground` | Try a call before a client does | Chat against an active model or combo |
| Media `/media` | Try an image model | Pick an image model and send a prompt through the same playground path |
| Evals `/evals` | Check a prompt still answers | Save a prompt and expected text, run it through the router, delete it |
| Agents `/agents` | Remember cloud, CLI, and ACP tools | Notes only. Skills tab at `/skills` stores instructions that are not executed |
| API keys `/keys` | One key for every client | Create, copy once, monthly cap, revoke with a confirm. Rate limit tab at `/limits` |
| Webhooks `/webhooks` | Hear about stored calls | HTTPS or localhost URLs, encrypted secret, signed POST, delete with a confirm |
| Batches `/batches` | See files and small batch jobs | Lists what `POST /v1/files` and `POST /v1/batches` stored |
| Activity `/activity` | Inspect calls | Search, success or error filter, paging, CSV export, clear with a confirm. Audit tab at `/audit` |
| Usage `/usage` | Watch volume | 7, 14, or 30 day chart and per-model totals |
| Costs `/costs` | Watch spend | Recorded cost, plus pricing, free-tier, and team-cap tabs |
| Health `/status` | See the process | Uptime, memory, listen address, provider call counts. Chaos, proxy, and console are tabs. `GET /health` stays the process check |
| Local `/memory` | Optional prompt helpers | Memory notes, response cache, and compression preview. All off until Settings enables them |
| Services `/services` | Bookmarks for other local tools | Opens the URL in the browser. WowRouter does not proxy it |
| Changelog `/changelog` | Read what shipped | Renders `CHANGELOG.md` |
| Settings `/settings` | Turn optional pieces on | Password and OIDC stay off by default, sidebar visibility, helpers, and clearing logs with a confirm |

Destructive buttons ask before they run. A toast confirms a save, copy, or delete. Empty lists say what to do next.
