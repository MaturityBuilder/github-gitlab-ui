import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const chromeBin = process.env.CHROME_BIN || "/opt/google/chrome/chrome";
const extensionDir = new URL("../extension", import.meta.url).pathname;
const profile = mkdtempSync(join(tmpdir(), "gl-look-live."));
const chrome = spawn(chromeBin, [
  "--headless=new",
  "--no-sandbox",
  "--disable-gpu",
  "--disable-dev-shm-usage",
  `--user-data-dir=${profile}`,
  "--remote-debugging-pipe",
  "--enable-unsafe-extension-debugging",
], { stdio: ["ignore", "ignore", "inherit", "pipe", "pipe"] });

const input = chrome.stdio[3];
const output = chrome.stdio[4];
let buf = Buffer.alloc(0);
const pending = new Map();
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

async function inspect(url, expression) {
  const target = await send("Target.createTarget", { url });
  const session = await send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
  await send("Runtime.enable", {}, session.sessionId);
  await new Promise((resolve) => setTimeout(resolve, 5000));
  const evaluated = await send("Runtime.evaluate", { expression, returnByValue: true }, session.sessionId);
  await send("Target.closeTarget", { targetId: target.targetId });
  return JSON.parse(evaluated.result.value);
}

const failures = [];
function assert(condition, message) {
  if (!condition) failures.push(message);
}

try {
  await send("Extensions.loadUnpacked", { path: extensionDir });
  const repo = await inspect(
    "https://github.com/cli/cli",
    "JSON.stringify({ labels: [...document.querySelectorAll('#gl-sidebar .gl-nav .gl-nav-label')].map((node) => node.textContent), mr: ((document.querySelector('#gl-sidebar a[data-section=pulls] .gl-count') || {}).textContent || '').trim(), mrTab: ((document.getElementById('pull-requests-repo-tab-count') || {}).textContent || '').trim(), issues: ((document.querySelector('#gl-sidebar a[data-section=issues] .gl-count') || {}).textContent || '').trim(), issuesTab: ((document.getElementById('issues-repo-tab-count') || {}).textContent || '').trim() })"
  );
  assert(repo.labels.includes("Merge requests"), `sidebar labels: ${repo.labels.join("|")}`);
  assert(repo.labels.includes("CI/CD"), "missing CI/CD");
  assert(!repo.labels.includes("Wiki"), "wiki should be omitted when the tab is absent");
  assert(repo.mr && repo.mr === repo.mrTab, `merge request count ${repo.mr} != ${repo.mrTab}`);
  assert(repo.issues && repo.issues === repo.issuesTab, `issue count ${repo.issues} != ${repo.issuesTab}`);

  const actions = await inspect(
    "https://github.com/cli/cli/actions",
    "JSON.stringify({ rows: document.querySelectorAll('.gl-pipeline-row').length, badge: (document.querySelector('.gl-pipeline-badge') || {}).textContent || '', labels: [...document.querySelectorAll('.ActionListItem-label, .ActionList-sectionDivider-title')].map((node) => node.textContent.trim()).filter((text) => /pipeline/i.test(text)) })"
  );
  assert(actions.rows > 0, "no pipeline rows");
  assert(actions.badge === "passed" || actions.badge === "failed" || actions.badge === "running", `badge: ${actions.badge}`);
  assert(actions.labels.includes("All pipelines"), `workflow labels: ${actions.labels.join("|")}`);

  const run = await inspect(
    "https://github.com/cli/cli/actions/runs/37145917029",
    "JSON.stringify({ pills: document.querySelectorAll('.gl-job-pill').length, hidden: !!document.querySelector('action-graph.gl-native-graph-hidden'), stage: (document.querySelector('.gl-stage-head span') || {}).textContent || '' })"
  );
  assert(run.pills === 3, `job pills: ${run.pills}`);
  assert(run.hidden, "native graph still visible");
  assert(run.stage === "Stage 1", `stage name: ${run.stage}`);

  const pull = await inspect(
    "https://github.com/cli/cli/pull/14583",
    "JSON.stringify({ title: document.title, control: !!document.getElementById('gl-comment-order'), pressed: (document.querySelector('#gl-comment-order button[aria-pressed=true]') || {}).textContent || '' })"
  );
  assert(pull.title.includes("Merge request #14583"), pull.title);
  assert(pull.control, "comment order control missing");
  assert(pull.pressed === "Oldest", `pressed: ${pull.pressed}`);
} catch (error) {
  failures.push(error.message);
} finally {
  chrome.kill();
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("Live GitHub check passed");
