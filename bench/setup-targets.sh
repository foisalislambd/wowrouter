#!/usr/bin/env bash
# Install the peer gateways the benchmark can launch. Binaries land in
# bench/.cache, which is gitignored. Re-run is safe: each step skips a
# file that is already present.
set -euo pipefail
cd "$(dirname "$0")/.."
cache="$PWD/bench/.cache"
mkdir -p "$cache/bin" "$cache/bifrost"

fetch() {
  local url="$1" dest="$2"
  if [[ -s "$dest" ]]; then
    echo "have $dest"
    return
  fi
  echo "get $url"
  curl -fsSL "$url" -o "$dest.partial"
  mv "$dest.partial" "$dest"
}

fetch "https://downloads.getmaxim.ai/bifrost/v2.4.0/linux/amd64/bifrost-http" "$cache/bin/bifrost-http"
chmod +x "$cache/bin/bifrost-http"

if [[ ! -s "$cache/bifrost/datasheet.json" ]]; then
  tmp="$(mktemp -d)"
  git clone --depth 1 --filter=blob:none --sparse https://github.com/foisalislambd/antirion.git "$tmp/antirion"
  git -C "$tmp/antirion" sparse-checkout set bench/targets/bifrost
  gzip -dc "$tmp/antirion/bench/targets/bifrost/datasheet.json.gz" > "$cache/bifrost/datasheet.json"
  gzip -dc "$tmp/antirion/bench/targets/bifrost/model-parameters.json.gz" > "$cache/bifrost/model-parameters.json"
  rm -rf "$tmp"
fi

if [[ ! -x "$cache/litellm-venv/bin/litellm" ]]; then
  python3 -m venv "$cache/litellm-venv"
  "$cache/litellm-venv/bin/pip" install --disable-pip-version-check "litellm[proxy]==1.106.6"
fi

if [[ ! -x "$cache/npm/node_modules/.bin/omniroute" ]]; then
  mkdir -p "$cache/npm"
  npm install --prefix "$cache/npm" --no-fund --no-audit \
    omniroute@3.8.52 \
    @portkey-ai/gateway@1.15.2
fi

if [[ ! -x "$cache/bin/ai-gateway-x86_64-unknown-linux-gnu/ai-gateway" ]]; then
  tmp="$(mktemp)"
  fetch "https://github.com/Helicone/ai-gateway/releases/download/v0.2.0-beta.30/ai-gateway-x86_64-unknown-linux-gnu.tar.xz" "$tmp"
  tar -C "$cache/bin" -xJf "$tmp"
  rm -f "$tmp"
  chmod +x "$cache/bin/ai-gateway-x86_64-unknown-linux-gnu/ai-gateway"
fi

if [[ ! -x "$cache/bin/antirion" ]]; then
  echo "Antirion has no published release binary. Building v0.1.1 (commit 32bebb0d6f8a) with Rust 1.98.1."
  src="${ANTIRION_SRC:-/tmp/antirion}"
  if [[ ! -f "$src/Cargo.toml" ]]; then
    git clone https://github.com/foisalislambd/antirion.git "$src"
  fi
  git -C "$src" checkout 32bebb0d6f8a
  if ! rustc --version | grep -q '1.98.1'; then
    rustup toolchain install 1.98.1
  fi
  (cd "$src" && cargo +1.98.1 build --release --locked -p antirion)
  cp "$src/target/release/antirion" "$cache/bin/antirion"
  chmod +x "$cache/bin/antirion"
fi

echo "installed:"
"$cache/bin/bifrost-http" -help >/dev/null
"$cache/litellm-venv/bin/litellm" --version
"$cache/npm/node_modules/.bin/omniroute" --version
node -e 'console.log("portkey", require("'"$cache/npm/node_modules/@portkey-ai/gateway/package.json"'").version)'
"$cache/bin/ai-gateway-x86_64-unknown-linux-gnu/ai-gateway" --version
"$cache/bin/antirion" version
