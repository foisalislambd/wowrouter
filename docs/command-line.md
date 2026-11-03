# Command line

The `wowrouter` command comes from `npm install -g wowrouter`. `airoute` is the same command from the `airoute` package. It starts the local router and can open the panel in your browser.

```bash
wowrouter
```

You should see two lines:

```text
Panel    http://127.0.0.1:8787
Base URL http://127.0.0.1:8787/v1
```

The panel is for you. The base URL is for Cursor and scripts.

## Everyday commands

| Command | What happens |
| --- | --- |
| `wowrouter` | Start in this terminal and open the panel |
| `wowrouter --detach` | Start in the background and open the panel |
| `wowrouter --no-open` | Start, and leave the browser alone |
| `wowrouter status` | Print the URLs if it is running, or say it is not |
| `wowrouter stop` | Shut the local router down |
| `wowrouter --help` | Print the short command list |

You can combine flags:

```bash
wowrouter --detach --no-open
wowrouter status --addr 127.0.0.1:8787
```

## Already running

If something is already answering on that port and it is WowRouter, the command does not start a second copy. It prints the URLs. With the default start command, it also opens the panel. A process that still reports `"service":"airoute"` counts as the same router.

`wowrouter stop` works on a router started by this npm package. If you are running an older desktop build that has no shutdown button in the API, quit that one from the tray icon instead. See [Desktop](desktop.md).

## Another port or folder

```bash
wowrouter --addr 127.0.0.1:8790
wowrouter --data D:\wowrouter
```

`--addr` must stay on this computer. `127.0.0.1`, `localhost`, and `::1` are accepted. A LAN address is rejected.

`--data` is the folder for the database and the encryption key. Omit it to use the normal folder in [Your data](your-data.md). Status and stop need the same `--addr` you started with.

## What the package contains

The installed package includes the web panel and a server program for Windows, Linux, and macOS. The command picks the program that matches your machine. You do not unpack it yourself.
