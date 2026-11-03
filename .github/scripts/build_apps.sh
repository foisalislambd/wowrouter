#!/usr/bin/env bash
set -euo pipefail

version="${VERSION:?package version is required}"
root="$(pwd)"
stage="${root}/dist/release"
rm -rf "${stage}"
mkdir -p "${stage}"

if [[ ! -f apps/panel/dist/index.html ]]; then
  echo "panel build is missing; run npm run build:panel first" >&2
  exit 1
fi

targets=(
  "windows amd64"
  "linux amd64"
  "darwin amd64"
  "darwin arm64"
)

for spec in "${targets[@]}"; do
  read -r goos goarch <<<"${spec}"
  work="$(mktemp -d)"
  bin="WowRouter"
  if [[ "${goos}" == "windows" ]]; then
    bin="WowRouter.exe"
  fi
  ldflags="-s -w"
  if [[ "${goos}" == "windows" ]]; then
    ldflags="${ldflags} -H windowsgui"
  fi
  CGO_ENABLED=0 GOOS="${goos}" GOARCH="${goarch}" \
    go build -trimpath -ldflags "${ldflags}" -o "${work}/${bin}" ./apps/desktop/cmd/wowrouter-desktop
  chmod +x "${work}/${bin}" || true
  mkdir -p "${work}/panel"
  cp -a apps/panel/dist/. "${work}/panel/"
  archive="${stage}/WowRouter-${version}-${goos}-${goarch}.zip"
  (cd "${work}" && zip -qr "${archive}" .)
  rm -rf "${work}"
  echo "built ${archive}"
done

cat > "${stage}/notes.md" <<EOF
WowRouter ${version}

Each archive is the desktop app plus the panel folder it serves.

- Windows: unzip and run \`WowRouter.exe\`. Closing the window leaves the router running. The tray icon opens it again or quits it. WebView2 comes with current Windows 10 and 11.
- macOS and Linux: unzip, run \`./WowRouter\`. Closing the browser tab leaves the router running until you stop the process.

The app listens on \`127.0.0.1:8787\`. Data stays in the local airoute-router folder.

Install the same version from npm with \`npm install -g wowrouter\`, then run \`wowrouter\`. \`npm install -g airoute\` and the \`airoute\` command are the same program. GitHub Packages has \`@foisalislambd/wowrouter\` and \`@foisalislambd/airoute\`.

Docker: \`docker run -d --name wowrouter -p 127.0.0.1:8787:8787 -v wowrouter:/data foisalislambd/wowrouter:latest\`. The same image is \`foisalislambd/airoute\`, \`ghcr.io/foisalislambd/wowrouter\`, and \`ghcr.io/foisalislambd/airoute\`. The panel is at http://127.0.0.1:8787.
EOF
