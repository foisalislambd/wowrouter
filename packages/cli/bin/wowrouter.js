#!/usr/bin/env node

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function parseArgs(argv) {
  const out = {
    command: "start",
    addr: "127.0.0.1:8787",
    data: "",
    open: true,
    detach: false,
    help: false,
  };
  const args = argv.slice();
  if (args[0] && !args[0].startsWith("-")) out.command = args.shift();
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg === "--no-open") out.open = false;
    else if (arg === "--detach") out.detach = true;
    else if (arg === "--addr") out.addr = args[(i += 1)] || "";
    else if (arg === "--data") out.data = args[(i += 1)] || "";
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!["start", "stop", "status"].includes(out.command)) throw new Error(`Unknown command: ${out.command}`);
  if (!out.addr || out.addr.startsWith("-")) throw new Error("--addr needs a host:port value");
  if (out.data.startsWith("-")) throw new Error("--data needs a directory");
  return out;
}

function urls(addr) {
  const panel = `http://${addr}`;
  return { panel, api: `${panel}/v1` };
}

function binaryPath() {
  const name = process.platform === "win32" ? "wowrouter.exe" : "wowrouter";
  const candidate = path.join(root, "vendor", `${process.platform}-${process.arch}`, name);
  return fs.existsSync(candidate) ? candidate : "";
}

async function probe(addr) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 800);
  try {
    const res = await fetch(`http://${addr}/health`, { signal: ctrl.signal });
    const body = await res.json();
    return res.ok && (body.service === "wowrouter" || body.service === "airoute");
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function printUrls(addr, already) {
  const link = urls(addr);
  if (already) console.log("WowRouter is already running.");
  console.log(`Panel    ${link.panel}`);
  console.log(`Base URL ${link.api}`);
}

function openPanel(panel) {
  if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", "", panel], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    return;
  }
  const command = process.platform === "darwin" ? "open" : "xdg-open";
  spawn(command, [panel], { detached: true, stdio: "ignore" }).unref();
}

function help() {
  console.log(`wowrouter starts the local router and opens its web panel.
  airoute is the same command.

  wowrouter                Start and open the panel
  wowrouter status         Show whether it is running
  wowrouter stop           Stop the router
  wowrouter --detach       Start in the background
  wowrouter --no-open      Start without opening the browser
  wowrouter --addr HOST:PORT
  wowrouter --data DIR

Cursor and other OpenAI clients use the printed base URL.`);
}

async function stop(addr) {
  if (!(await probe(addr))) {
    console.log("WowRouter is not running.");
    return;
  }
  const res = await fetch(`http://${addr}/api/shutdown`, { method: "POST" });
  if (res.status === 204) {
    console.log("WowRouter stopped.");
    return;
  }
  if (res.status === 404) {
    throw new Error("This WowRouter is already running, but it cannot be stopped from npm. Quit it from the tray icon.");
  }
  throw new Error(`Could not stop WowRouter (HTTP ${res.status}).`);
}

async function start(opts) {
  if (await probe(opts.addr)) {
    printUrls(opts.addr, true);
    if (opts.open) openPanel(urls(opts.addr).panel);
    return;
  }
  const bin = binaryPath();
  if (!bin) {
    throw new Error(`No WowRouter program is packaged for ${process.platform}-${process.arch}.`);
  }
  const panel = path.join(root, "panel");
  if (!fs.existsSync(path.join(panel, "index.html"))) {
    throw new Error("The web panel is missing from this install.");
  }
  const args = ["-addr", opts.addr, "-web", panel];
  if (opts.data) args.push("-data", opts.data);
  const child = spawn(bin, args, {
    detached: opts.detach,
    stdio: opts.detach ? "ignore" : "inherit",
    windowsHide: true,
  });
  const started = await Promise.race([
    waitReady(opts.addr).then((ok) => (ok ? "ready" : "timeout")),
    new Promise((resolve) => child.once("exit", () => resolve("exit"))),
  ]);
  if (started !== "ready") {
    if (child.exitCode == null) child.kill();
    throw new Error("WowRouter did not start.");
  }
  printUrls(opts.addr, false);
  if (opts.open) openPanel(urls(opts.addr).panel);
  if (opts.detach) {
    child.unref();
    return;
  }
  await new Promise((resolve, reject) => {
    child.on("exit", (code) => {
      if (code) reject(new Error(`WowRouter exited with code ${code}.`));
      else resolve();
    });
  });
}

function waitReady(addr) {
  const deadline = Date.now() + 8000;
  return new Promise((resolve) => {
    const tick = async () => {
      if (await probe(addr)) {
        resolve(true);
        return;
      }
      if (Date.now() > deadline) {
        resolve(false);
        return;
      }
      setTimeout(tick, 150);
    };
    tick();
  });
}

async function main(argv) {
  const opts = parseArgs(argv);
  if (opts.help) {
    help();
    return;
  }
  if (opts.command === "status") {
    if (await probe(opts.addr)) printUrls(opts.addr, true);
    else console.log("WowRouter is not running.");
    return;
  }
  if (opts.command === "stop") {
    await stop(opts.addr);
    return;
  }
  await start(opts);
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}

module.exports = { parseArgs, urls, binaryPath };
