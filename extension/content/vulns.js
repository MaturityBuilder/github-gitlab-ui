(function () {
  const GL = (globalThis.GitLabLook = globalThis.GitLabLook || {});

  const SEVERITY_RANK = { critical: 4, high: 3, medium: 2, low: 1, unknown: 0 };
  function advisoryIds(text) {
    return [...String(text || "").matchAll(/\b(GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}|CVE-\d{4}-\d{4,7})\b/gi)].map((match) =>
      normalizeAdvisory(match[1] || match[0])
    );
  }
  const MANIFEST_NAMES = [
    "package.json",
    "package-lock.json",
    "npm-shrinkwrap.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "go.mod",
    "go.sum",
    "requirements.txt",
    "Pipfile",
    "Pipfile.lock",
    "poetry.lock",
    "pyproject.toml",
    "Gemfile",
    "Gemfile.lock",
    "composer.json",
    "composer.lock",
    "pom.xml",
    "build.gradle",
    "build.gradle.kts",
    "Cargo.toml",
    "Cargo.lock",
    "packages.config",
    "pubspec.yaml",
    "mix.exs",
    "Podfile",
    "Podfile.lock",
    "Package.swift",
  ];
  const ECOSYSTEM = {
    "package.json": "npm",
    "package-lock.json": "npm",
    "npm-shrinkwrap.json": "npm",
    "yarn.lock": "npm",
    "pnpm-lock.yaml": "npm",
    "go.mod": "go",
    "go.sum": "go",
    "requirements.txt": "pip",
    pipfile: "pip",
    "pipfile.lock": "pip",
    "poetry.lock": "pip",
    "pyproject.toml": "pip",
    gemfile: "ruby",
    "gemfile.lock": "ruby",
    "composer.json": "composer",
    "composer.lock": "composer",
    "pom.xml": "maven",
    "build.gradle": "gradle",
    "build.gradle.kts": "gradle",
    "cargo.toml": "cargo",
    "cargo.lock": "cargo",
    "packages.config": "nuget",
    "pubspec.yaml": "pub",
    "mix.exs": "mix",
    podfile: "cocoapods",
    "podfile.lock": "cocoapods",
    "package.swift": "swift",
  };

  const memory = {};
  const signatures = {};
  const hydrated = {};
  const fetched = {};

  function normalizeAdvisory(id) {
    if (/^ghsa-/i.test(id)) return id.toLowerCase();
    return id.toUpperCase();
  }

  function unique(values) {
    const seen = new Set();
    const result = [];
    values.forEach((value) => {
      if (!value || seen.has(value)) return;
      seen.add(value);
      result.push(value);
    });
    return result;
  }

  function findManifest(text) {
    const source = String(text || "");
    let found = "";
    MANIFEST_NAMES.forEach((name) => {
      const pattern = new RegExp("(?:[\\w.@~+-]+/)*" + name.replace(/\./g, "\\."), "gi");
      const matches = source.match(pattern) || [];
      matches.forEach((match) => {
        if (match.length > found.length) found = match;
      });
    });
    return found;
  }

  function findRange(text) {
    const match = String(text || "").match(
      /(?:<=|>=|<|>|=)\s*v?\d+\.\d+\.\d+(?:\s*,\s*(?:<=|>=|<|>|=)\s*v?\d+\.\d+\.\d+)*/
    );
    return match ? match[0].replace(/\s+/g, " ").trim() : "";
  }

  function packageFromText(text) {
    const source = String(text || "").replace(/\s+/g, " ").trim();
    const bump = source.match(/\bBump\s+([@A-Za-z0-9_./+-]+)\s+from\s+/i);
    if (bump) return bump[1];
    const named = source.match(/\bin\s+([@A-Za-z0-9_./+-]+)\s*$/i);
    if (named) return named[1];
    return "";
  }

  function spacedText(node) {
    if (!node) return "";
    if (node.nodeType === 3 || node.nodeType === 4) {
      return String(node.nodeValue || "").replace(/\s+/g, " ").trim();
    }
    const parts = [];
    const children = node.childNodes || [];
    for (let index = 0; index < children.length; index += 1) {
      const part = spacedText(children[index]);
      if (part) parts.push(part);
    }
    return parts.join(" ");
  }

  function valueAfterLabel(root, labelRe) {
    const nodes = root.querySelectorAll("dt, h1, h2, h3, h4, strong, span, div, p, th");
    for (const node of nodes) {
      if (node.closest("#gl-sidebar, #gl-pipeline-graph, #gl-job-bar, #gl-mr-pipelines, #gl-mr-security")) continue;
      const text = spacedText(node);
      if (!text || text.length > 40 || !labelRe.test(text)) continue;
      const next = node.nextElementSibling;
      if (next) {
        const value = spacedText(next);
        if (value) return value;
      }
    }
    return "";
  }

  function makeAlert(fields) {
    const severity = String(fields.severity || "").toLowerCase();
    return {
      number: String(fields.number || ""),
      package: fields.package || "",
      severity: SEVERITY_RANK[severity] ? severity : "unknown",
      manifest: fields.manifest || "",
      range: fields.range || "",
      advisories: unique((fields.advisories || []).map(normalizeAdvisory)),
      href: fields.href || "",
      state: fields.state === "closed" ? "closed" : "open",
    };
  }

  function parseAlertLinks(doc, repo) {
    const prefix = "/" + repo.owner + "/" + repo.repo + "/security/dependabot/";
    const alerts = [];
    doc.querySelectorAll("a[href*='" + prefix + "']").forEach((link) => {
      const href = link.getAttribute("href") || "";
      const numberMatch = href.match(/\/security\/dependabot\/(\d+)/);
      if (!numberMatch) return;
      const row = link.closest("li, tr, article, .Box-row, [data-testid*='alert']") || link.parentElement || link;
      const rowText = spacedText(row).slice(0, 2000);
      const linkText = spacedText(link);
      const advisories = advisoryIds(rowText);
      const explicit = link.dataset.glAdvisory || row.dataset.glAdvisory || "";
      if (explicit) advisories.push(normalizeAdvisory(explicit));
      const severityText = link.dataset.glSeverity || row.dataset.glSeverity || rowText;
      const severityMatch = severityText.match(/\b(critical|high|medium|low)\b/i);
      const stateText = link.dataset.glState || row.dataset.glState || rowText;
      const closed = /\b(dismissed|closed)\b/i.test(stateText) && !/\bopen\b/i.test(stateText);
      alerts.push(
        makeAlert({
          number: numberMatch[1],
          package: link.dataset.glPackage || row.dataset.glPackage || packageFromText(linkText) || packageFromText(rowText),
          severity: severityMatch ? severityMatch[1] : "",
          manifest: link.dataset.glManifest || row.dataset.glManifest || findManifest(rowText),
          range: link.dataset.glRange || row.dataset.glRange || findRange(rowText),
          advisories: advisories,
          href: href,
          state: closed ? "closed" : "open",
        })
      );
    });
    return alerts;
  }

  function parseDetail(doc, repo) {
    const path = GL.pagePath ? GL.pagePath(doc) : "";
    const match = String(path || "").match(/\/security\/dependabot\/(\d+)/);
    if (!match) return [];
    const root = doc.querySelector("main") || doc.body;
    if (!root) return [];
    const text = spacedText(root).slice(0, 8000);
    const advisories = advisoryIds(text);
    const packageName = valueAfterLabel(root, /^package$/i) || packageFromText(text);
    if (!packageName && !advisories.length) return [];
    const severityText = valueAfterLabel(root, /^severity$/i) || text;
    const severityMatch = severityText.match(/\b(critical|high|medium|low)\b/i);
    const closed = /\b(dismissed|closed)\b/i.test(text.slice(0, 500)) && !/\bopen\b/i.test(text.slice(0, 500));
    return [
      makeAlert({
        number: match[1],
        package: packageName,
        severity: severityMatch ? severityMatch[1] : "",
        manifest: valueAfterLabel(root, /^(manifest|affected files?|dependency file)$/i) || findManifest(text),
        range: valueAfterLabel(root, /^affected versions?$/i) || findRange(text),
        advisories: advisories,
        href: "/" + repo.owner + "/" + repo.repo + "/security/dependabot/" + match[1],
        state: closed ? "closed" : "open",
      }),
    ];
  }

  function parsePull(doc, repo) {
    const path = GL.pagePath ? GL.pagePath(doc) : "";
    if (!/\/pull\/\d+(?:\/|$)/.test("/" + String(path || "").replace(/^\//, ""))) return [];
    const description = doc.querySelector(".js-comment-body, .comment-body");
    if (!description) return [];
    const text = spacedText(description);
    const pageText = spacedText(doc.body).slice(0, 2500);
    if (!/dependabot/i.test(pageText) || !/GHSA-|CVE-\d{4}-|vulnerab/i.test(text)) return [];
    const bump = text.match(/Bump\s+([@A-Za-z0-9_./+-]+)\s+from\s+v?\d+\.\d+\.\d+\s+to\s+v?(\d+\.\d+\.\d+)/i);
    const alertLink = description.querySelector("a[href*='/security/dependabot/']");
    const stateNode = doc.querySelector(".State, [data-testid='header-state']");
    const stateText = stateNode ? spacedText(stateNode) : "";
    const manifestNode = doc.querySelector("[data-tagsearch-path], [data-path]");
    const manifest =
      findManifest(text) ||
      (manifestNode ? findManifest(manifestNode.getAttribute("data-tagsearch-path") || manifestNode.getAttribute("data-path") || "") : "");
    return [
      makeAlert({
        number: (alertLink && ((alertLink.getAttribute("href") || "").match(/\/(\d+)(?:[/?#]|$)/) || [])[1]) || "",
        package: bump ? bump[1] : packageFromText(text),
        severity: (text.match(/\b(critical|high|medium|low)\b/i) || [])[1] || "",
        manifest: manifest,
        range: findRange(text) || (bump ? "< " + bump[2] : ""),
        advisories: advisoryIds(text),
        href: alertLink ? alertLink.getAttribute("href") : "/" + String(path || "").replace(/^\//, ""),
        state: /merged|closed/i.test(stateText) ? "closed" : "open",
      }),
    ];
  }

  function alertKey(alert) {
    return [alert.number, alert.package, alert.manifest, alert.advisories.join(",")].join("|");
  }

  function dedupe(alerts) {
    const map = new Map();
    alerts.forEach((alert) => {
      if (!alert.package && !alert.advisories.length) return;
      const key = alertKey(alert);
      const previous = map.get(key);
      map.set(key, previous ? Object.assign({}, previous, alert, { advisories: unique(previous.advisories.concat(alert.advisories)) }) : alert);
    });
    return [...map.values()].slice(0, 200);
  }

  function parseDependabotDocument(doc, repo, options) {
    if (!repo) return [];
    const alerts = parseAlertLinks(doc, repo);
    if (!options || !options.linksOnly) {
      alerts.push(...parseDetail(doc, repo));
      alerts.push(...parsePull(doc, repo));
    }
    return dedupe(alerts);
  }

  function compareVersions(left, right) {
    const a = String(left).split(".").map((part) => parseInt(part, 10) || 0);
    const b = String(right).split(".").map((part) => parseInt(part, 10) || 0);
    for (let index = 0; index < 3; index += 1) {
      if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) - (b[index] || 0);
    }
    return 0;
  }

  function versionInRange(version, range) {
    const parts = String(range || "")
      .split(/\s*,\s*/)
      .map((part) => part.trim())
      .filter(Boolean);
    if (!parts.length) return true;
    return parts.every((part) => {
      const match = part.match(/^(<=|>=|<|>|=)?\s*v?(\d+\.\d+\.\d+)/);
      if (!match) return true;
      const op = match[1] || "=";
      const delta = compareVersions(version, match[2]);
      if (op === "<") return delta < 0;
      if (op === "<=") return delta <= 0;
      if (op === ">") return delta > 0;
      if (op === ">=") return delta >= 0;
      return delta === 0;
    });
  }

  function fileMatchesManifest(file, manifest) {
    if (!file || !manifest) return false;
    const norm = (value) => String(value).replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase();
    const left = norm(file);
    const right = norm(manifest);
    if (left === right || left.endsWith("/" + right) || right.endsWith("/" + left)) return true;
    const dir = (value) => value.split("/").slice(0, -1).join("/");
    const base = (value) => value.split("/").pop();
    const family = ECOSYSTEM[base(left)];
    return Boolean(family) && family === ECOSYSTEM[base(right)] && dir(left) === dir(right);
  }

  function remember(key, alerts) {
    const next = dedupe(alerts);
    const signature = JSON.stringify(next);
    if (signatures[key] === signature) return;
    memory[key] = next;
    signatures[key] = signature;
    const area = globalThis.chrome && chrome.storage && chrome.storage.local;
    if (!area) return;
    area.get({ dependabotAlerts: {} }, (stored) => {
      const all = Object.assign({}, (stored && stored.dependabotAlerts) || {});
      all[key] = { savedAt: Date.now(), alerts: next };
      area.set({ dependabotAlerts: all });
    });
  }

  function hydrate(key) {
    if (hydrated[key]) return;
    hydrated[key] = true;
    const area = globalThis.chrome && chrome.storage && chrome.storage.local;
    if (!area) return;
    area.get({ dependabotAlerts: {} }, (stored) => {
      const saved = ((((stored || {}).dependabotAlerts || {})[key] || {}).alerts) || [];
      if (!saved.length) return;
      const before = signatures[key] || "";
      remember(key, (memory[key] || []).concat(saved));
      if ((signatures[key] || "") !== before && GL.requestRender) GL.requestRender();
    });
  }

  function scheduleFetch(key, repo) {
    if (fetched[key] || (memory[key] && memory[key].length)) return;
    fetched[key] = true;
    const view = document.defaultView || window;
    if (!view.location || view.location.protocol === "file:") return;
    const url = "https://github.com/" + repo.owner + "/" + repo.repo + "/security/dependabot";
    fetch(url, { credentials: "include", headers: { Accept: "text/html" } })
      .then((response) => {
        if (!response.ok || /\/login(?:\?|$)/.test(response.url)) return "";
        return response.text();
      })
      .then((html) => {
        if (!html || !GL.parseRepo) return;
        const parsed = new DOMParser().parseFromString(html, "text/html");
        const alerts = parseDependabotDocument(parsed, repo, { linksOnly: true });
        if (!alerts.length) return;
        const before = signatures[key] || "";
        remember(key, (memory[key] || []).concat(alerts));
        if ((signatures[key] || "") !== before && GL.requestRender) GL.requestRender();
      })
      .catch(() => {});
  }

  function pageFilePath(doc) {
    const crumbs = doc.querySelector("[data-testid='breadcrumbs']");
    const named = doc.querySelector("[data-testid='breadcrumbs-filename']");
    if (crumbs && named) {
      const dirs = [...crumbs.querySelectorAll("a")]
        .map((link) => link.textContent.trim())
        .filter(Boolean);
      const name = named.textContent.replace(/\s+/g, " ").trim().replace(/^\//, "");
      return dirs.slice(1).concat(name).filter(Boolean).join("/");
    }
    if (doc.body && doc.body.dataset.glFile) return doc.body.dataset.glFile;
    const path = GL.pagePath ? GL.pagePath(doc) : "";
    const blob = String(path || "").match(/\/(?:blob|blame)\/[^/]+\/(.+)$/);
    return blob ? decodeURIComponent(blob[1]) : "";
  }

  function fileFor(element, doc) {
    const holder = element.closest("[data-tagsearch-path], [data-path]");
    if (holder) {
      const value = holder.getAttribute("data-tagsearch-path") || holder.getAttribute("data-path") || "";
      if (value) return value;
    }
    return pageFilePath(doc);
  }

  function versionsNear(text, packageName) {
    const lower = text.toLowerCase();
    const needle = packageName.toLowerCase();
    const index = lower.indexOf(needle);
    if (index < 0) return [];
    const window = text.slice(index + packageName.length, index + packageName.length + 80);
    return [...window.matchAll(/\d+\.\d+\.\d+/g)].map((match) => match[0]);
  }

  function tokenPattern(token, flags) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp("(^|[^A-Za-z0-9_.@/+-])(" + escaped + ")(?![A-Za-z0-9_./+-])", flags || "");
  }

  function mentionsToken(text, token) {
    if (!token) return false;
    return tokenPattern(token, "i").test(text);
  }

  function lineHits(text, alerts, inLog, file) {
    const hits = [];
    alerts.forEach((alert) => {
      alert.advisories.forEach((id) => {
        if (mentionsToken(text, id)) hits.push({ alert: alert, token: id });
      });
      if (!alert.package || !mentionsToken(text, alert.package)) return;
      if (inLog) {
        const versions = versionsNear(text, alert.package);
        const vulnerableVersion = Boolean(alert.range) && versions.some((version) => versionInRange(version, alert.range));
        const wording = /vulnerab|dependabot|security alert/i.test(text);
        if (wording || vulnerableVersion || alert.advisories.some((id) => text.indexOf(id) !== -1)) {
          hits.push({ alert: alert, token: alert.package });
        }
        return;
      }
      if (!file || !fileMatchesManifest(file, alert.manifest)) return;
      const versions = versionsNear(text, alert.package);
      if (versions.length && alert.range && !versions.some((version) => versionInRange(version, alert.range))) return;
      hits.push({ alert: alert, token: alert.package });
    });
    return hits;
  }

  function findRanges(text, hits) {
    const ranges = [];
    hits.forEach((hit) => {
      const pattern = tokenPattern(hit.token, "gi");
      let match;
      while ((match = pattern.exec(text))) {
        const start = match.index + match[1].length;
        ranges.push({ start: start, end: start + match[2].length, alert: hit.alert });
      }
    });
    ranges.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
    const kept = [];
    let cursor = 0;
    ranges.forEach((range) => {
      if (range.start < cursor) return;
      kept.push(range);
      cursor = range.end;
    });
    return kept;
  }

  function worstAlert(hits) {
    return hits.reduce((best, hit) => {
      if (!best) return hit.alert;
      return (SEVERITY_RANK[hit.alert.severity] || 0) > (SEVERITY_RANK[best.severity] || 0) ? hit.alert : best;
    }, null);
  }

  function vulnLabel(alert) {
    const severity = alert.severity === "unknown" ? "Dependabot alert" : "Dependabot " + alert.severity;
    const name = alert.package ? ": " + alert.package : "";
    const range = alert.range ? " (" + alert.range + ")" : "";
    return severity + name + range;
  }

  function wrapText(node, hits) {
    const ranges = findRanges(node.nodeValue, hits);
    if (!ranges.length) return false;
    const doc = node.ownerDocument;
    const fragment = doc.createDocumentFragment();
    let cursor = 0;
    const insideLink = Boolean(node.parentElement && node.parentElement.closest("a"));
    ranges.forEach((range) => {
      if (range.start > cursor) fragment.appendChild(doc.createTextNode(node.nodeValue.slice(cursor, range.start)));
      const mark = doc.createElement(insideLink ? "mark" : "a");
      mark.className = "gl-vuln";
      mark.dataset.severity = range.alert.severity || "unknown";
      mark.title = vulnLabel(range.alert);
      if (!insideLink) {
        mark.href = range.alert.href || "#";
      }
      mark.textContent = node.nodeValue.slice(range.start, range.end);
      fragment.appendChild(mark);
      cursor = range.end;
    });
    if (cursor < node.nodeValue.length) fragment.appendChild(doc.createTextNode(node.nodeValue.slice(cursor)));
    node.parentNode.replaceChild(fragment, node);
    return true;
  }

  function highlightLine(line, alerts, doc) {
    if (line.closest("#gl-sidebar, #gl-pipeline-graph, #gl-job-bar, #gl-comment-order, #gl-mr-pipelines, #gl-mr-security, .gl-vuln-note")) return;
    const inLog = Boolean(line.closest("check-step, .js-check-step, #logs"));
    const file = inLog ? "" : fileFor(line, doc);
    const text = line.textContent || "";
    const hits = lineHits(text, alerts, inLog, file);
    if (!hits.length) return;
    const walker = doc.createTreeWalker(line, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        if (node.parentElement && node.parentElement.closest(".gl-vuln, .gl-vuln-note")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    let changed = false;
    nodes.forEach((node) => {
      if (wrapText(node, hits)) changed = true;
    });
    const top = worstAlert(hits);
    if (top && line.dataset.severity !== top.severity) line.dataset.severity = top.severity;
    line.classList.add("gl-vuln-line");
    const codeLine = line.matches("[data-testid='code-cell'], .blob-code-inner, td.blob-code");
    if (!codeLine && top && !line.querySelector(":scope > .gl-vuln-note")) {
      const note = doc.createElement("a");
      note.className = "gl-vuln-note";
      note.dataset.severity = top.severity;
      note.href = top.href || "#";
      note.title = vulnLabel(top);
      note.textContent = (top.severity === "unknown" ? "alert" : top.severity) + (top.package ? " · " + top.package : "");
      line.appendChild(note);
    }
    return changed;
  }

  function lineElements(doc) {
    const selector = [
      "[data-testid='code-cell']",
      ".blob-code-inner",
      "td.blob-code",
      "check-step [class*='log-line']",
      "check-step [class*='LogLine']",
      ".js-check-step [class*='log-line']",
      "#logs [class*='log-line']",
    ].join(", ");
    const lines = [...doc.querySelectorAll(selector)];
    if (lines.length) return lines;
    return [...doc.querySelectorAll("check-step, .js-check-step")];
  }

  function pullFilePaths(doc) {
    const files = [];
    doc.querySelectorAll("[data-path], [data-tagsearch-path]").forEach((node) => {
      const value = node.getAttribute("data-path") || node.getAttribute("data-tagsearch-path") || "";
      if (value) files.push(value);
    });
    return files;
  }

  function alertsForMergeRequest(doc, alerts) {
    const files = pullFilePaths(doc);
    if (!files.length) return alerts.slice();
    const matched = alerts.filter((alert) =>
      files.some((file) => fileMatchesManifest(file, alert.manifest) || (alert.package && file.toLowerCase().indexOf(alert.package.toLowerCase()) > -1))
    );
    return matched.length ? matched : alerts.slice();
  }

  function sortAlerts(alerts) {
    return alerts.slice().sort((a, b) => (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0) || String(a.package).localeCompare(String(b.package)));
  }

  function isPullPage(path) {
    return /\/pull\/\d+/.test(String(path || ""));
  }

  function isSecurityView(doc) {
    return (GL.pageHash ? GL.pageHash(doc) : "") === "#gl-security";
  }

  function renderFinding(doc, alert) {
    const row = doc.createElement("a");
    row.className = "gl-security-finding";
    row.href = alert.href || "#";
    const badge = doc.createElement("span");
    badge.className = "gl-status gl-severity-" + (alert.severity || "unknown");
    badge.textContent = alert.severity === "unknown" ? "alert" : alert.severity;
    const name = doc.createElement("span");
    name.className = "gl-vuln";
    name.dataset.severity = alert.severity || "unknown";
    name.textContent = alert.package || alert.advisories[0] || "Dependabot alert";
    const meta = doc.createElement("span");
    meta.className = "gl-security-finding-meta";
    meta.textContent = [alert.manifest, alert.range, alert.advisories[0]].filter(Boolean).join(" · ");
    row.append(badge, name, meta);
    return row;
  }

  function securityMount(doc) {
    return (
      doc.querySelector("#partial-discussion-sidebar") ||
      doc.getElementById("gl-mr-pipelines") ||
      doc.querySelector(".js-check-suites-sidebar")
    );
  }

  function mountSecurityConsole(doc, host) {
    const expanded = isSecurityView(doc);
    host.className = "gl-mr-security gl-mr-console" + (expanded ? " is-expanded" : "");
    const discussion = doc.querySelector("#partial-discussion-sidebar");
    if (discussion) {
      if (host.parentElement !== discussion) discussion.insertBefore(host, discussion.firstChild);
      return;
    }
    const rail = GL.ensureMrRail ? GL.ensureMrRail(doc) : doc.getElementById("gl-mr-rail");
    if (rail) {
      const pipelines = doc.getElementById("gl-mr-pipelines");
      if (pipelines && pipelines.parentElement === rail) rail.insertBefore(host, pipelines);
      else rail.appendChild(host);
      return;
    }
    const checks = doc.querySelector(".js-check-suites-sidebar");
    if (checks && checks.parentElement) {
      checks.parentElement.appendChild(host);
      return;
    }
    if (expanded && !host.parentElement && doc.body) doc.body.appendChild(host);
  }

  function renderMrSecurity(doc, repo, alerts) {
    const path = GL.pagePath ? GL.pagePath(doc) : "";
    const existing = doc.getElementById("gl-mr-security");
    if (!repo || !isPullPage(path) || (!securityMount(doc) && !isSecurityView(doc))) {
      if (existing) existing.remove();
      return;
    }
    const findings = sortAlerts(alertsForMergeRequest(doc, alerts));
    const expanded = isSecurityView(doc);
    const signature = findings.map((alert) => alert.number + ":" + alert.package + ":" + alert.severity + ":" + alert.state).join("|") + "|" + (expanded ? "1" : "0");
    let host = doc.getElementById("gl-mr-security");
    if (host && host.dataset.signature === signature) {
      mountSecurityConsole(doc, host);
      return;
    }
    if (!host) {
      host = doc.createElement("aside");
      host.id = "gl-mr-security";
    }
    host.dataset.signature = signature;
    mountSecurityConsole(doc, host);
    host.replaceChildren();
    const heading = doc.createElement("h2");
    heading.className = "gl-mr-security-title";
    heading.textContent = "Security";
    const summary = doc.createElement("p");
    summary.className = "gl-mr-security-summary";
    if (!findings.length) {
      summary.textContent = "No open Dependabot findings";
      const all = doc.createElement("a");
      all.href = "/" + repo.owner + "/" + repo.repo + "/security/dependabot";
      all.textContent = "Dependabot alerts";
      host.append(heading, summary, all);
      return;
    }
    const high = findings.filter((alert) => alert.severity === "critical" || alert.severity === "high").length;
    summary.textContent =
      findings.length +
      " open Dependabot finding" +
      (findings.length === 1 ? "" : "s") +
      (high ? " · " + high + " high or critical" : "");
    host.append(heading, summary);
    findings.forEach((alert) => host.appendChild(renderFinding(doc, alert)));
    const more = doc.createElement("a");
    more.className = "gl-mr-security-more";
    more.href = "/" + repo.owner + "/" + repo.repo + "/security/dependabot";
    more.textContent = "All Dependabot alerts";
    host.appendChild(more);
  }

  function paint(doc, alerts) {
    if (!alerts.length) {
      clearLineHighlights(doc);
      return;
    }
    lineElements(doc).forEach((line) => highlightLine(line, alerts, doc));
  }

  function clearLineHighlights(doc) {
    doc.querySelectorAll(".gl-vuln").forEach((mark) => {
      if (mark.closest("#gl-mr-security")) return;
      const parent = mark.parentNode;
      if (!parent) return;
      parent.replaceChild(doc.createTextNode(mark.textContent), mark);
      parent.normalize();
    });
    doc.querySelectorAll(".gl-vuln-note").forEach((note) => {
      if (note.closest("#gl-mr-security")) return;
      note.remove();
    });
    doc.querySelectorAll(".gl-vuln-line").forEach((line) => {
      if (line.closest("#gl-mr-security")) return;
      line.classList.remove("gl-vuln-line");
      delete line.dataset.severity;
    });
  }

  function clearVulns(doc) {
    clearLineHighlights(doc);
    const host = doc.getElementById("gl-mr-security");
    if (host) host.remove();
    const rail = doc.getElementById("gl-mr-rail");
    if (rail && !rail.querySelector("#gl-mr-pipelines")) rail.remove();
  }

  function applyVulns(doc) {
    if (!GL.parseRepo || !GL.pagePath) return;
    const repo = GL.parseRepo(GL.pagePath(doc));
    if (!repo) {
      clearVulns(doc);
      return;
    }
    const key = repo.owner + "/" + repo.repo;
    const found = parseDependabotDocument(doc, repo);
    if (found.length) remember(key, (memory[key] || []).concat(found));
    hydrate(key);
    const open = (memory[key] || []).filter((alert) => alert.state !== "closed");
    paint(doc, open);
    renderMrSecurity(doc, repo, open);
    if (!found.length) scheduleFetch(key, repo);
  }

  GL.parseDependabotAlerts = parseDependabotDocument;
  GL.versionInRange = versionInRange;
  GL.fileMatchesManifest = fileMatchesManifest;
  GL.applyVulns = applyVulns;
  GL.clearVulns = clearVulns;
})();
