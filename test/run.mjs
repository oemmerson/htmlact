#!/usr/bin/env node
// Serve test/index.html and run it in a Chrome started with
// --remote-debugging-port (default 9222), then report the results.
//
//   test/build.sh && node test/run.mjs
//
// Uses only Node built-ins: global fetch and WebSocket, and an http server.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const cdpPort = Number(process.env.CDP_PORT || 9222);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
};

const driver = path.join(root, "test", "htmlact-page.js");
if (!fs.existsSync(driver)) {
  console.error("test/htmlact-page.js is missing; run test/build.sh first");
  process.exit(2);
}

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, "http://localhost");
  const file = path.join(root, decodeURIComponent(pathname));
  if (!file.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, {
      "content-type": types[path.extname(file)] || "application/octet-stream",
    });
    res.end(data);
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const appPort = server.address().port;

const cdp = (p, opts) =>
  fetch(`http://127.0.0.1:${cdpPort}${p}`, opts);
const page = `http://127.0.0.1:${appPort}/test/index.html`;

const newRes = await cdp(`/json/new?${encodeURIComponent(page)}`, {
  method: "PUT",
});
if (!newRes.ok) {
  console.error(
    `cannot open a tab: ${newRes.status}. Is Chrome running with --remote-debugging-port=${cdpPort}?`,
  );
  server.close();
  process.exit(2);
}
const target = await newRes.json();

const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    if (m.error) reject(new Error(JSON.stringify(m.error)));
    else resolve(m.result);
  }
});
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve);
  ws.addEventListener("error", () => reject(new Error("cannot connect to Chrome")));
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const i = ++id;
    pending.set(i, { resolve, reject });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
await send("Runtime.enable");
await send("Page.enable");
// A background tab has its timers throttled, which stalls the test page.
await send("Page.bringToFront");
// Background pages have their timers throttled; pretend the page is focused
// so the driver's settle timers run at their real speed.
await send("Emulation.setFocusEmulationEnabled", { enabled: true });

const evaluate = async (expression) => {
  const r = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  return r.result?.value;
};

let done = false;
let waited = 0;
while (waited < 90000 && !done) {
  await new Promise((r) => setTimeout(r, 100));
  waited += 100;
  done = await evaluate(
    "!!(window.__htmlactTests && window.__htmlactTests.done)",
  ).catch(() => false);
}

const results = done
  ? await evaluate("window.__htmlactTests.results")
  : [];

ws.close();
await fetch(`http://127.0.0.1:${cdpPort}/json/close/${target.id}`).catch(() => {});
server.close();

if (!done) {
  console.error("the test page did not finish");
  process.exit(1);
}
let failed = 0;
for (const r of results) {
  if (r.ok) console.log(`ok   ${r.name}`);
  else {
    failed += 1;
    console.log(`FAIL ${r.name}\n     ${r.error}`);
  }
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed === 0 ? 0 : 1);
