(function () {
  const GL = (globalThis.GitLabLook = globalThis.GitLabLook || {});

  const STATUS_RANK = {
    failed: 5,
    running: 4,
    pending: 3,
    waiting: 3,
    canceled: 2,
    skipped: 1,
    success: 0,
  };

  const STATUS_LABEL = {
    success: "passed",
    failed: "failed",
    running: "running",
    pending: "pending",
    waiting: "waiting",
    canceled: "canceled",
    skipped: "skipped",
  };

  function pagePath(doc) {
    const fromBody = doc.body && doc.body.dataset.glPath;
    if (fromBody) return fromBody;
    const view = doc.defaultView;
    return (view && view.location && view.location.pathname) || "";
  }

  function parseStatus(label) {
    const value = String(label || "").toLowerCase();
    if (/fail/.test(value)) return "failed";
    if (/cancel/.test(value)) return "canceled";
    if (/skip/.test(value)) return "skipped";
    if (/progress|running/.test(value)) return "running";
    if (/wait/.test(value)) return "waiting";
    if (/queue|pending/.test(value)) return "pending";
    if (/success|passed|complete/.test(value)) return "success";
    return "pending";
  }

  function statusLabel(status) {
    return STATUS_LABEL[status] || status;
  }

  function worstStatus(jobs) {
    const meaningful = jobs.filter((job) => job.status !== "skipped");
    const pool = meaningful.length ? meaningful : jobs;
    let worst = "success";
    pool.forEach((job) => {
      if ((STATUS_RANK[job.status] || 0) > (STATUS_RANK[worst] || 0)) worst = job.status;
    });
    return jobs.length ? worst : "skipped";
  }

  function normalizeName(text) {
    return String(text || "")
      .replace(/\u00a0/g, " ")
      .replace(/\s*\/\s*/g, " / ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function sharedPrefix(names) {
    const parts = names.map((name) => name.split(" / ").map((part) => part.trim()));
    if (!parts.length || parts.some((part) => part.length < 2)) return null;
    const first = parts[0][0];
    if (!first || !parts.every((part) => part[0] === first)) return null;
    return first;
  }

  function stageName(jobs, index) {
    const names = jobs.map((job) => job.name).filter(Boolean);
    const prefix = sharedPrefix(names);
    if (prefix) return prefix;
    if (names.length === 1) return names[0];
    return "Stage " + (index + 1);
  }

  function groupIntoStages(jobs) {
    const columns = new Map();
    jobs.forEach((job) => {
      const column = job.column || 0;
      if (!columns.has(column)) columns.set(column, []);
      columns.get(column).push(job);
    });
    return [...columns.keys()]
      .sort((a, b) => a - b)
      .map((column, index) => {
        const group = columns.get(column);
        return {
          name: stageName(group, index),
          status: worstStatus(group),
          jobs: group,
        };
      });
  }

  function topologicalColumns(jobs) {
    const byId = new Map();
    jobs.forEach((job) => byId.set(job.id, job));
    const memo = new Map();
    function depth(job, trail) {
      if (memo.has(job.id)) return memo.get(job.id);
      if (trail.has(job.id)) return 0;
      trail.add(job.id);
      let value = 0;
      (job.needs || []).forEach((need) => {
        const parent = byId.get(need);
        if (parent) value = Math.max(value, depth(parent, trail) + 1);
      });
      trail.delete(job.id);
      memo.set(job.id, value);
      return value;
    }
    return jobs.map((job) => Object.assign({}, job, { column: depth(job, new Set()) }));
  }

  function jobNameFrom(node) {
    const named = node.querySelectorAll("[data-target='streaming-graph-job.name'], .workflow-path-first-item");
    if (named.length) {
      const chunks = [];
      named.forEach((part) => chunks.push(part.textContent));
      const link = node.querySelector("a");
      const raw = link ? link.textContent : chunks.join(" / ");
      return normalizeName(raw);
    }
    const link = node.querySelector("a[href*='/job/']") || node.querySelector("a");
    return normalizeName(link ? link.textContent : node.textContent);
  }

  function statusFromClass(node) {
    const svg = node.querySelector("svg");
    const cls = `${(svg && svg.getAttribute("class")) || ""} ${node.className || ""}`;
    if (/check-circle|color-fg-success|octicon-check/.test(cls)) return "success";
    if (/x-circle|color-fg-danger|octicon-x/.test(cls)) return "failed";
    if (/skip|neutral-check/.test(cls)) return "skipped";
    if (/square-fill|octicon-stop/.test(cls)) return "canceled";
    if (/sync|in-progress|octicon-dot-fill/.test(cls)) return "running";
    if (/octicon-circle\b/.test(cls)) return "skipped";
    return "";
  }

  function statusFrom(node) {
    const icon = node.querySelector("svg[aria-label]");
    const label = icon && icon.getAttribute("aria-label");
    if (label && /fail|cancel|skip|progress|running|wait|queue|pending|success|passed|complete/i.test(label)) {
      return parseStatus(label);
    }
    return statusFromClass(node) || (node.dataset.status ? parseStatus(node.dataset.status) : "pending");
  }

  function durationFrom(node) {
    const explicit = node.querySelector("[data-duration], .duration, .gl-duration, time");
    if (explicit) return normalizeName(explicit.textContent);
    return "";
  }

  function needsFrom(node) {
    const raw = node.dataset.needs || "";
    return raw
      .split(/[\s,]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function readJob(node, column) {
    const link = node.querySelector("a[href*='/job/']") || node.querySelector("a");
    return {
      id: node.dataset.jobId || (link && link.getAttribute("href")) || jobNameFrom(node),
      name: jobNameFrom(node),
      status: statusFrom(node),
      href: link ? link.getAttribute("href") : "",
      duration: durationFrom(node),
      needs: needsFrom(node),
      column: column,
    };
  }

  function extractJobs(doc) {
    const stages = [...doc.querySelectorAll(".WorkflowStage")];
    if (stages.length) {
      const jobs = [];
      stages.forEach((stage, column) => {
        const nodes = stage.querySelectorAll("streaming-graph-job, [data-targets='action-graph.jobs'], [data-gl-job]");
        nodes.forEach((node) => jobs.push(readJob(node, column)));
      });
      return jobs.filter((job) => job.name);
    }
    const nodes = [...doc.querySelectorAll("streaming-graph-job, [data-gl-job]")];
    const jobs = nodes.map((node) => readJob(node, 0));
    if (jobs.some((job) => job.needs.length)) return topologicalColumns(jobs);
    return jobs;
  }

  function hideNativeGraph(doc) {
    doc.querySelectorAll("action-graph, .WorkflowGraph").forEach((node) => {
      node.classList.add("gl-native-graph-hidden");
    });
  }

  function showNativeGraph(doc) {
    doc.querySelectorAll("action-graph, .WorkflowGraph").forEach((node) => {
      node.classList.remove("gl-native-graph-hidden");
    });
  }

  function renderGraph(doc, jobs) {
    const signature = jobs.map((job) => job.id + ":" + job.status + ":" + job.column).join("|");
    let host = doc.getElementById("gl-pipeline-graph");
    if (host && host.dataset.signature === signature) {
      hideNativeGraph(doc);
      return host;
    }
    if (!host) {
      host = doc.createElement("div");
      host.id = "gl-pipeline-graph";
      host.className = "gl-pipeline-graph";
      const anchor = doc.querySelector("action-graph, .WorkflowGraph");
      if (anchor && anchor.parentElement) anchor.parentElement.insertBefore(host, anchor);
      else if (doc.body) doc.body.appendChild(host);
    }
    host.dataset.signature = signature;
    host.replaceChildren();
    groupIntoStages(jobs).forEach((stage) => {
      const column = doc.createElement("section");
      column.className = "gl-stage";
      const head = doc.createElement("div");
      head.className = "gl-stage-head";
      const title = doc.createElement("span");
      title.textContent = stage.name;
      const badge = doc.createElement("span");
      badge.className = "gl-status gl-status-" + stage.status;
      badge.textContent = statusLabel(stage.status);
      head.append(title, badge);
      column.appendChild(head);
      stage.jobs.forEach((job) => {
        const pill = doc.createElement("a");
        pill.className = "gl-job-pill";
        pill.href = job.href || "#";
        const dot = doc.createElement("span");
        dot.className = "gl-status-dot gl-status-dot-" + job.status;
        const name = doc.createElement("span");
        name.className = "gl-job-name";
        name.textContent = job.name;
        pill.append(dot, name);
        if (job.duration) {
          const duration = doc.createElement("span");
          duration.className = "gl-job-duration";
          duration.textContent = job.duration;
          pill.appendChild(duration);
        }
        column.appendChild(pill);
      });
      host.appendChild(column);
    });
    hideNativeGraph(doc);
    return host;
  }

  function runIdFromHref(href) {
    const match = String(href || "").match(/\/actions\/runs\/(\d+)/);
    return match ? match[1] : "";
  }

  function shortRunNumber(row) {
    const match = (row.textContent || "").match(/#(\d+)\s*:/);
    return match ? match[1] : "";
  }

  function relabelWorkflowNav(doc) {
    doc.querySelectorAll(".ActionListItem-label, .ActionList-sectionDivider-title").forEach((node) => {
      const text = node.textContent.trim();
      const replacement = {
        "All workflows": "All pipelines",
        Workflows: "Pipelines",
        "Show more workflows...": "Show more pipelines...",
      }[text];
      if (!replacement) return;
      if (!node.dataset.glOriginal) node.dataset.glOriginal = text;
      node.textContent = replacement;
    });
    const sidebar = doc.querySelector("nav[aria-label='Actions'], .Layout-sidebar");
    if (sidebar) sidebar.classList.add("gl-actions-sidebar");
  }

  function restoreWorkflowNav(doc) {
    doc.querySelectorAll("[data-gl-original]").forEach((node) => {
      if (
        node.dataset.glOriginal === "All workflows" ||
        node.dataset.glOriginal === "Workflows" ||
        node.dataset.glOriginal === "Show more workflows..."
      ) {
        node.textContent = node.dataset.glOriginal;
        delete node.dataset.glOriginal;
      }
    });
  }

  function renderList(doc) {
    relabelWorkflowNav(doc);
    const rows = doc.querySelectorAll(".Box-row, [data-gl-pipeline-row]");
    rows.forEach((row) => {
      const link = row.querySelector("a[href*='/actions/runs/']");
      if (!link || /\/job\//.test(link.getAttribute("href") || "")) return;
      const href = link.getAttribute("href");
      const runId = shortRunNumber(row) || runIdFromHref(href);
      const status = statusFrom(row);
      const signature = status + "|" + runId + "|" + href;
      if (row.dataset.glSignature === signature) return;
      row.dataset.glSignature = signature;
      let badge = row.querySelector(".gl-pipeline-badge");
      if (!badge) {
        badge = doc.createElement("span");
        badge.className = "gl-pipeline-badge";
      }
      badge.className = "gl-pipeline-badge gl-status gl-status-" + status;
      badge.textContent = statusLabel(status);
      let idLink = row.querySelector(".gl-pipeline-id");
      if (!idLink) {
        idLink = doc.createElement("a");
        idLink.className = "gl-pipeline-id";
      }
      idLink.href = href;
      idLink.textContent = "#" + runId;
      link.classList.add("gl-pipeline-subject");
      let meta = row.querySelector(".gl-pipeline-meta");
      if (!meta) {
        meta = doc.createElement("div");
        meta.className = "gl-pipeline-meta";
        row.appendChild(meta);
      }
      meta.replaceChildren();
      const branch = row.querySelector("a[href*='/tree/']");
      if (branch) {
        const pill = doc.createElement("a");
        pill.className = "gl-branch-pill";
        pill.href = branch.getAttribute("href");
        pill.textContent = branch.textContent.trim();
        meta.appendChild(pill);
      }
      const actor = row.querySelector("a[data-hovercard-type='user']");
      if (actor) {
        const person = doc.createElement("span");
        person.textContent = actor.textContent.trim();
        meta.appendChild(person);
      }
      const durationIcon = row.querySelector("svg[aria-label='Run duration']");
      if (durationIcon && durationIcon.parentElement) {
        const duration = normalizeName(durationIcon.parentElement.textContent);
        if (duration) {
          const time = doc.createElement("span");
          time.textContent = duration;
          meta.appendChild(time);
        }
      }
      let leading = row.querySelector(":scope > .gl-pipeline-leading");
      if (!leading) {
        leading = doc.createElement("div");
        leading.className = "gl-pipeline-leading";
        row.prepend(leading);
      }
      leading.append(badge, idLink);
      row.classList.add("gl-pipeline-row");
    });
    const heading = doc.querySelector("h1");
    if (heading && heading.textContent.trim() === "Workflow runs" && !heading.dataset.glOriginal) {
      heading.dataset.glOriginal = "Workflow runs";
      heading.textContent = "Pipelines";
    }
  }

  function renderJob(doc, path) {
    const match = path.match(/\/actions\/runs\/(\d+)\/job\/(\d+)/);
    if (!match) return;
    const nameNode = doc.querySelector("#check-step-header-title, h1");
    const name = normalizeName(nameNode ? nameNode.textContent : "Job");
    const status = statusFrom(doc.querySelector(".js-check-steps, .CheckRun, body") || doc.body);
    const signature = status + "|" + name + "|" + match[1];
    let bar = doc.getElementById("gl-job-bar");
    if (bar && bar.dataset.signature === signature) return;
    if (!bar) {
      bar = doc.createElement("div");
      bar.id = "gl-job-bar";
      bar.className = "gl-job-bar";
      const logs = doc.querySelector("#logs, .js-check-steps");
      if (logs && logs.parentElement) logs.parentElement.insertBefore(bar, logs);
      else if (doc.body) doc.body.insertBefore(bar, doc.body.firstChild);
    }
    bar.dataset.signature = signature;
    bar.replaceChildren();
    const badge = doc.createElement("span");
    badge.className = "gl-status gl-status-" + status;
    badge.textContent = statusLabel(status);
    const title = doc.createElement("strong");
    title.textContent = name;
    const back = doc.createElement("a");
    back.href = path.replace(/\/job\/\d+$/, "");
    back.textContent = "Pipeline #" + match[1];
    bar.append(badge, title, back);
  }

  function clearPipeline(doc) {
    const graph = doc.getElementById("gl-pipeline-graph");
    if (graph) graph.remove();
    const bar = doc.getElementById("gl-job-bar");
    if (bar) bar.remove();
    showNativeGraph(doc);
    doc.querySelectorAll(".gl-pipeline-badge, .gl-pipeline-id, .gl-pipeline-meta, .gl-pipeline-leading").forEach((node) => node.remove());
    doc.querySelectorAll(".gl-pipeline-row").forEach((row) => {
      row.classList.remove("gl-pipeline-row");
      delete row.dataset.glSignature;
    });
    restoreWorkflowNav(doc);
    doc.querySelectorAll("h1[data-gl-original='Workflow runs']").forEach((heading) => {
      heading.textContent = heading.dataset.glOriginal;
      delete heading.dataset.glOriginal;
    });
  }

  function applyPipeline(doc) {
    const path = pagePath(doc);
    if (!/\/actions(\/|$)/.test(path)) {
      clearPipeline(doc);
      return;
    }
    if (/\/actions\/runs\/\d+\/job\/\d+/.test(path)) {
      const graph = doc.getElementById("gl-pipeline-graph");
      if (graph) graph.remove();
      showNativeGraph(doc);
      renderJob(doc, path);
      return;
    }
    const bar = doc.getElementById("gl-job-bar");
    if (bar) bar.remove();
    if (/\/actions\/runs\/\d+/.test(path)) {
      const jobs = extractJobs(doc);
      if (!jobs.length) return;
      renderGraph(doc, jobs);
      return;
    }
    const graph = doc.getElementById("gl-pipeline-graph");
    if (graph) graph.remove();
    showNativeGraph(doc);
    renderList(doc);
  }

  GL.parseStatus = parseStatus;
  GL.groupIntoStages = groupIntoStages;
  GL.topologicalColumns = topologicalColumns;
  GL.extractJobs = extractJobs;
  GL.applyPipeline = applyPipeline;
  GL.clearPipeline = clearPipeline;
  GL.pagePath = pagePath;
})();
