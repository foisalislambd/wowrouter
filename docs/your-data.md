# Your data

WowRouter keeps everything it needs in one folder on your computer. Provider keys, the router-key hashes, the call log, and desktop settings are in that folder. They are not uploaded by the app.

## Where the folder is

| System | Folder |
| --- | --- |
| Windows | `%AppData%\airoute-router` |
| macOS | `~/Library/Application Support/airoute-router` |
| Linux | `$XDG_CONFIG_HOME/airoute-router`, or `~/.config/airoute-router` |

On Windows you can paste `%AppData%\airoute-router` into Explorer. The panel's Settings page also shows the path.

The npm command and the desktop app share this folder when you do not pass another one. That means keys you save in the desktop app are the keys the `wowrouter` command uses, and the other way around. `airoute` uses this folder too.

## Files

| File | What it is |
| --- | --- |
| `airoute.db` | Providers, model switches, router-key hashes, activity, fallbacks |
| `secret.key` | The local key that encrypts provider API keys |
| `desktop.json` | Whether Windows should start the router at login |
| `agent.log` | Notes from the desktop background process |

Router keys are not stored in a form the panel can show again. You copy `sk-airoute-...` when you create it. If you lose it, create another key and delete the old one.

Provider keys can be decrypted only with the `secret.key` that was present when they were saved. If you copy the database to a new machine, copy `secret.key` with it. Replacing the secret without the database, or the database without the secret, leaves the provider keys unreadable.

## Choose a different folder

```bash
wowrouter --data D:\wowrouter
```

The desktop app uses the default folder. A custom `--data` folder is a separate router: its own keys, its own log.

## Delete or move

Stopping the router and deleting the folder wipes keys, logs, and the Windows startup preference. Export or copy the folder first if you still want those keys.

Moving the folder is safe when `airoute.db` and `secret.key` move together, and you then start WowRouter with `--data` pointed at the new folder. The desktop app will keep using the default location until you copy the files back there.

## What stays on this computer

The listen address has to be loopback: `127.0.0.1`, `localhost`, or `::1`. The panel is open to any program on this computer, because it has no login of its own. Do not tunnel port 8787 to the public internet. Anything that can open that port can open the panel and read the local API.

Calls still go out to the provider you selected, using the key you saved. That part leaves the machine, the same way a direct API call would. The activity log of those calls stays local.
