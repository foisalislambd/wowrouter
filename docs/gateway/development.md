# Console development

The web UI is the Vite app in `apps/panel`. The Go server serves that build at `/`.

```bash
npm install
npm run dev:panel
npm run dev:server
```

The panel dev server is `http://127.0.0.1:5173` and proxies `/api` and `/v1` to the Go process. Sign in with the admin token printed on first start (`bootstrap-token` in the data folder).

`npm run build:panel` writes `apps/panel/dist`. The server, the desktop app, the npm package, and the Docker image all serve that folder.
