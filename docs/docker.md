# Docker

The Docker image is this router and the web panel. It is published as [foisalislambd/wowrouter](https://hub.docker.com/r/foisalislambd/wowrouter) and as `ghcr.io/foisalislambd/wowrouter`. The same image is also [foisalislambd/airoute](https://hub.docker.com/r/foisalislambd/airoute) and `ghcr.io/foisalislambd/airoute`.

The older image on that Docker Hub page used port `20128` and a separate `latest-web` tag. This image listens on port `8787`. There is no browser or cookie image. Use `latest` or a version tag such as `1.1.2`.

## Start

```bash
docker run -d --name wowrouter \
  -p 127.0.0.1:8787:8787 \
  -v wowrouter:/data \
  foisalislambd/wowrouter:latest
```

`foisalislambd/airoute:latest` is the same image. Open `http://127.0.0.1:8787`. Point Cursor at `http://127.0.0.1:8787/v1`.

`127.0.0.1:8787:8787` means only this computer can open the panel. Inside the container the server listens on all interfaces, which is what Docker needs in order to publish the port. Do not publish it as `8787:8787` unless you want every machine on your network to reach the panel. The panel has no login.

From the repo, Compose builds the local source and names that image `wowrouter:local`. It does not pull the published `latest` tag. The Compose volume is `wowrouter`.

```bash
docker compose up -d --build
```

## Your keys

The volume `/data` holds `airoute.db` and `secret.key`. It is not the same folder as `%AppData%\airoute-router`. Keys you saved in the desktop app are not inside the container until you copy those two files into the volume.

```bash
docker stop wowrouter
docker rm wowrouter
```

Removing the container does not delete the volume. `docker volume rm wowrouter` does.

## Updates

```bash
docker pull foisalislambd/wowrouter:latest
docker rm -f wowrouter
docker run -d --name wowrouter \
  -p 127.0.0.1:8787:8787 \
  -v wowrouter:/data \
  foisalislambd/wowrouter:latest
```

Keep the volume name `wowrouter` so the keys stay.

## GitHub's copy

```bash
docker pull ghcr.io/foisalislambd/wowrouter:latest
```

`ghcr.io/foisalislambd/airoute` is the same image. Pulling from GitHub Container Registry can ask you to log in even when the image is public. Docker Hub does not.

## Tags

| Tag | What it is |
| --- | --- |
| `latest` | Newest published image of this router |
| `1.1.2` | That exact version |

`latest-web` is left over from the previous project. Do not use it for this router.
