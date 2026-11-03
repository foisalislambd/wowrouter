# Install

You can run WowRouter from npm, or by unzipping a desktop build. Both serve the same panel and the same API.

You need Node.js 20 or newer for the npm package. The desktop zip does not need Node.

## From npm

```bash
npm install -g wowrouter
wowrouter
```

`npm install -g airoute` installs the same program, and `airoute` runs the same commands.

Your browser opens `http://127.0.0.1:8787`. Leave that terminal open if you did not use `--detach`. Closing the browser tab does not stop the router. Stop it with `wowrouter stop`.

The same release is also published as `@foisalislambd/wowrouter` and `@foisalislambd/airoute` on GitHub Packages. Installing from GitHub Packages usually needs a GitHub login token with package read access.

```bash
npm install -g @foisalislambd/wowrouter --registry https://npm.pkg.github.com
```

More commands are in the [command line](command-line.md) guide.

## From a desktop download

1. Open the [releases](https://github.com/foisalislambd/wowrouter/releases) page.
2. Download the zip for your system. The names look like `WowRouter-1.1.6-windows-amd64.zip`.
3. Unzip it. Keep the `WowRouter` program and the `panel` folder side by side.
4. Run `WowRouter` (`WowRouter.exe` on Windows).

Windows opens a window and also keeps the router running after you close that window. The tray icon opens it again or quits it. Details are in the [desktop](desktop.md) guide.

## Check that it is running

Open `http://127.0.0.1:8787/health` in a browser. A healthy router answers:

```json
{"service":"wowrouter","status":"ok"}
```

An older build may still answer `"service":"airoute"`. That is the same router.

If the page does not load, the router is not running. Start it again with `wowrouter`, or by opening the desktop app.

## What to do next

Open the panel and follow [Panel](panel.md). After you have a provider key and a router key, connect [Cursor](use-with-cursor.md).
