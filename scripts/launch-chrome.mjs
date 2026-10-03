import { spawn } from "node:child_process";

const chromeBin = process.env.CHROME_BIN;
const extensionDir = process.argv[2];
const profile = process.argv[3];
const urls = process.argv.slice(4);
const headless = process.env.GL_LOOK_HEADLESS === "1";
const check = process.env.GL_LOOK_CHECK === "1";

if (!chromeBin || !extensionDir || !profile) {
  console.error("Usage: CHROME_BIN=... launch-chrome.mjs <extension-dir> <profile> [url...]");
  process.exit(1);
}

const args = [
  headless ? "--headless=new" : "",
  "--no-sandbox",
  "--disable-gpu",
  "--disable-dev-shm-usage",
  "--no-first-run",
  "--no-default-browser-check",
  `--user-data-dir=${profile}`,
  "--remote-debugging-pipe",
  "--enable-unsafe-extension-debugging",
].filter(Boolean);

const chrome = spawn(chromeBin, args, { stdio: ["ignore", "inherit", "inherit", "pipe", "pipe"] });
const input = chrome.stdio[3];
const output = chrome.stdio[4];
let buf = Buffer.alloc(0);
const pending = new Map();
let ready = false;

output.on("data", (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  while (true) {
    const index = buf.indexOf(0);
    if (index === -1) break;
    const raw = buf.slice(0, index).toString();
    buf = buf.slice(index + 1);
    if (!raw.trim()) continue;
    let message;
    try {
      message = JSON.parse(raw);
    } catch (error) {
      continue;
    }
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  }
});

let seq = 1;
function send(method, params, sessionId) {
  const id = seq++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${method}`)), 20000);
    pending.set(id, (message) => {
      clearTimeout(timer);
      if (message.error) reject(new Error(message.error.message || JSON.stringify(message.error)));
      else resolve(message.result || {});
    });
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    input.write(`${JSON.stringify(payload)}\0`);
  });
}

chrome.on("exit", (code) => {
  if (!ready) {
    console.error(`Chrome exited before the extension loaded (${code ?? "unknown"}).`);
    process.exit(code && code !== 0 ? code : 1);
  }
  process.exit(code || 0);
});

chrome.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});

try {
  const loaded = await send("Extensions.loadUnpacked", { path: extensionDir });
  if (!loaded.id) throw new Error("Chrome did not return an extension id.");
  for (const url of urls) {
    const target = await send("Target.createTarget", { url });
    if (check) {
      const session = await send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
      await send("Runtime.enable", {}, session.sessionId);
      await new Promise((resolve) => setTimeout(resolve, 5000));
      const evaluated = await send(
        "Runtime.evaluate",
        {
          expression: "document.documentElement.classList.contains('gl-look') && !!document.getElementById('gl-sidebar')",
          returnByValue: true,
        },
        session.sessionId
      );
      if (!evaluated.result || evaluated.result.value !== true) {
        throw new Error("Extension loaded, but the GitLab skin was not applied.");
      }
      console.log("extension loaded");
    }
  }
  ready = true;
  if (check) {
    chrome.kill();
  }
} catch (error) {
  console.error(error.message);
  ready = true;
  chrome.kill();
  process.exit(1);
}
