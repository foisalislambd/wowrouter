# Changelog

Versions follow the `version` field in the root `package.json`. Releases are published from `main`.

## Unreleased

- One gateway and one Vite panel, served at `/`. `/ui` redirects there.
- The database is `wowrouter.db` in the `wowrouter` data folder. First start imports providers, provider keys, models, fallbacks, and settings from an older install and leaves those files in place. Old router keys are not imported. Create new keys; they start with `sk-wowrouter-`.
- npm, Docker Hub, and GitHub Packages still publish the `airoute` package name, the `airoute` command, and the `foisalislambd/airoute` and `ghcr.io/foisalislambd/airoute` images. Those names are the same WowRouter build.
- The panel follows the Antirion console layout and is served at `/`. It is derived from that console, Copyright 2026 Elias Biondo, Apache-2.0, and was modified. See NOTICE.
- The provider directory includes the models.dev catalog. A provider can hold more than one API key. The activity-log queue is capped so a busy closed loop does not hold hundreds of megabytes of pending rows.

## 1.1.2

- Run WowRouter with Docker. The image is `foisalislambd/airoute` on Docker Hub and `ghcr.io/foisalislambd/airoute` on GitHub.
- The container listens on port 8787. Data is stored in `/data`.

## 1.1.0

This is the first release of the local Go router and the web panel.

- Install with `npm install -g airoute`, or download a desktop build from GitHub releases.
- The panel and the OpenAI-compatible API stay on `127.0.0.1:8787`.
- Chat, image, video, and decision calls use a router key that starts with `sk-airoute-`.
- On Windows, the desktop app can keep running after the window closes, with a tray icon and start-with-Windows.
- The same version is published to npm and to GitHub Packages as `@foisalislambd/airoute`.

Earlier npm versions were a previous codebase. They are not this router.
