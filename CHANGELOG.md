# Changelog

Versions follow the `version` field in the root `package.json`. Releases are published from `main`.

## Unreleased

- The product name is WowRouter. npm, Docker Hub, and GitHub Packages still publish `airoute`, and they also publish `wowrouter`.
- Existing data stays in the `airoute-router` folder, in `airoute.db`. Router keys still start with `sk-airoute-`.

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
