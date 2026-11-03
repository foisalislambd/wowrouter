# Guides

WowRouter runs on your computer and gives Cursor, scripts, and other tools one local OpenAI-style address. These pages walk through each part. Start with install, then the panel, then the tool you actually use.

| Guide | Read this when you want to |
| --- | --- |
| [Install](install.md) | Get the router running from npm or a desktop download |
| [Docker](docker.md) | Run the panel and API in a container |
| [Panel](panel.md) | Add keys, turn models on, and look around the web page |
| [Use with Cursor](use-with-cursor.md) | Point Cursor, or any OpenAI client, at WowRouter |
| [Command line](command-line.md) | Start, stop, and check the npm command |
| [Desktop app](desktop.md) | Use the window, the tray, and start-with-Windows |
| [Providers and models](providers-and-models.md) | Pick a provider, a model id, and a fallback |
| [API](api.md) | Call chat, images, video, and the model list |
| [Decisions](decisions.md) | Ask a yes/no, choice, or score question |
| [Your data](your-data.md) | See where keys and logs live, and how to move them |
| [Develop](develop.md) | Run the project from source |

The two addresses you will use most:

| What | Address |
| --- | --- |
| Web panel | `http://127.0.0.1:8787` |
| API for Cursor and scripts | `http://127.0.0.1:8787/v1` |

The router only listens on this computer. Another machine on your network cannot open it.

To change the code, start with [Develop](develop.md) and [CONTRIBUTING.md](../CONTRIBUTING.md). The license is [MIT](../LICENSE).
