# Develop

Use this page when you are changing WowRouter itself. If you only want to run it, use [Install](install.md).

You need Go 1.26 or newer and Node.js 20 or newer.

```bash
npm install
```

## Two processes for the panel

In one terminal:

```bash
npm run dev:server
```

In another:

```bash
npm run dev:panel
```

Open `http://127.0.0.1:5173`. That is the Vite dev server. It talks to the Go router on `http://127.0.0.1:8787`. The Go process also serves a built panel at port 8787 when `apps/panel/dist` exists.

Stop any desktop app or `wowrouter` process first if port 8787 is already taken.

## Desktop shell

```bash
npm run build:panel
npm run dev:desktop
```

The desktop command starts the same server and opens a native window. On Windows, closing the window leaves the server running until you quit from the tray.

## npm package

```bash
npm run build:npm
```

This builds the panel and the server binaries into `packages/cli`. Try it without publishing:

```bash
node packages/cli/bin/wowrouter.js --addr 127.0.0.1:8793 --no-open
```

Use a free port when 8787 is already your daily router. Stop the test copy with:

```bash
node packages/cli/bin/wowrouter.js stop --addr 127.0.0.1:8793
```

`packages/cli/vendor` and `packages/cli/panel` are build output. They are not committed.

## Layout

| Path | What it is |
| --- | --- |
| `apps/server` | Go router, SQLite, HTTP API |
| `apps/panel` | React panel |
| `apps/desktop` | Window, tray, and background agent |
| `packages/cli` | The `wowrouter` and `airoute` npm commands |
| `packages/sse` | Parser for OpenAI server-sent chat streams |
| `docs` | These guides |

The catalog of providers is generated. Change the generator and regenerate. Do not hand-edit `apps/server/internal/catalog/catalog_generated.go`.

## Tests

From the repo root:

```bash
go test ./apps/server/...
node --test packages/cli/bin/wowrouter.test.js
```

On Windows, `go test` can print `ok` and still exit 1 when it cannot delete the test executable because the file is locked. Run it again before treating that as a failed test. If the test output itself failed, that exit code is real.

## Releases

The version that gets published is the `version` field in the root `package.json`. Pushing `main` with a version higher than the latest tag builds the desktop zips, publishes `wowrouter` and `airoute` to npm, publishes `@foisalislambd/wowrouter` and `@foisalislambd/airoute` to GitHub Packages, pushes both Docker image names, and creates the GitHub release.

Put `skip release` in the commit message when that push should not publish.

The panel package and `packages/sse` have their own versions. Those do not drive the GitHub release.
