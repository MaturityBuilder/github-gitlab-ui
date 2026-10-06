(function () {
  const GL = (globalThis.GitLabLook = globalThis.GitLabLook || {});

  const RESERVED = new Set([
    "about",
    "account",
    "apps",
    "codespace",
    "codespaces",
    "collections",
    "contact",
    "copilot",
    "customer-stories",
    "dashboard",
    "discussions",
    "education",
    "enterprise",
    "events",
    "explore",
    "features",
    "git-guides",
    "issues",
    "join",
    "login",
    "marketplace",
    "new",
    "nonprofit",
    "notifications",
    "org",
    "orgs",
    "organizations",
    "pricing",
    "pull",
    "pulls",
    "readme",
    "resources",
    "search",
    "security",
    "sessions",
    "settings",
    "signup",
    "site",
    "solutions",
    "sponsors",
    "stars",
    "team",
    "topics",
    "trending",
    "users",
    "watching",
    "why-github",
  ]);

  let rendering = false;
  let settings = { enabled: true, commentOrder: "asc" };

  function storageArea() {
    return globalThis.chrome && chrome.storage && chrome.storage.local;
  }

  function readSettings() {
    const defaults = { enabled: true, commentOrder: "asc" };
    const area = storageArea();
    if (!area) {
      let enabled = true;
      let commentOrder = "asc";
      try {
        enabled = localStorage.getItem("gl-enabled") !== "false";
        commentOrder = localStorage.getItem("gl-comment-order") || "asc";
      } catch (error) {
        enabled = true;
      }
      return Promise.resolve({ enabled, commentOrder });
    }
    return new Promise((resolve) => {
      area.get(defaults, (stored) => resolve(Object.assign({}, defaults, stored)));
    });
  }

  function saveCommentOrder(order) {
    settings.commentOrder = order === "desc" ? "desc" : "asc";
    const area = storageArea();
    if (area) area.set({ commentOrder: settings.commentOrder });
    else {
      try {
        localStorage.setItem("gl-comment-order", settings.commentOrder);
      } catch (error) {
        /* fixture pages can run without storage */
      }
    }
  }

  function parseRepo(path) {
    const parts = String(path || "").split("/").filter(Boolean);
    if (parts.length < 2) return null;
    if (RESERVED.has(parts[0])) return null;
    return { owner: parts[0], repo: parts[1], rest: parts.slice(2).join("/") };
  }

  function sectionFor(rest) {
    if (/^(issues|labels|milestones)(\/|$)/.test(rest)) return "issues";
    if (/^(pulls|pull)(\/|$)/.test(rest)) return "pulls";
    if (/^actions(\/|$)/.test(rest)) return "actions";
    if (/^wiki(\/|$)/.test(rest)) return "wiki";
    if (/^(pulse|community|dependency-graph|contributors|people)(\/|$)/.test(rest)) return "insights";
    if (/^settings(\/|$)/.test(rest)) return "settings";
    return "repo";
  }

  function hasWiki(doc, repo) {
    return Boolean(
      doc.querySelector("#wiki-tab, a[href='/" + repo.owner + "/" + repo.repo + "/wiki'], a[href^='/" + repo.owner + "/" + repo.repo + "/wiki/']")
    );
  }

  function focusSearch(doc) {
    const selectors = [
      "input[data-testid='search-input']",
      "#query-builder-test",
      "qbsearch-input input",
      "input[name='q']",
      "input[type='search']",
      "button[aria-label*='Search']",
      "[data-target='qbsearch-input.inputButton']",
    ];
    for (const selector of selectors) {
      const node = doc.querySelector(selector);
      if (!node) continue;
      node.focus();
      if (typeof node.click === "function") node.click();
      return;
    }
  }

  function icon(doc, pathD) {
    const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("width", "16");
    svg.setAttribute("height", "16");
    svg.setAttribute("aria-hidden", "true");
    const path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("fill", "currentColor");
    path.setAttribute("d", pathD);
    svg.appendChild(path);
    return svg;
  }

  function readCounter(doc, id, fallback) {
    const node = doc.getElementById(id) || doc.querySelector(fallback);
    if (!node) return null;
    const text = node.textContent.replace(/\s+/g, " ").trim();
    const title = (node.getAttribute("title") || "").trim();
    if (!text || /not available/i.test(text) || /not available/i.test(title)) return null;
    return { text: text, title: title || text };
  }

  function navCounts(doc) {
    return {
      issues: readCounter(doc, "issues-repo-tab-count", "#issues-tab .Counter"),
      pulls: readCounter(doc, "pull-requests-repo-tab-count", "#pull-requests-tab .Counter"),
    };
  }

  function ensureSidebar(doc, repo) {
    const path = GL.pagePath(doc);
    let sidebar = doc.getElementById("gl-sidebar");
    const wiki = repo && hasWiki(doc, repo) ? "1" : "0";
    const counts = navCounts(doc);
    const countKey = (counts.issues ? counts.issues.text : "-") + "/" + (counts.pulls ? counts.pulls.text : "-");
    const key = repo ? repo.owner + "/" + repo.repo + "/" + wiki + "/" + countKey : "";
    if (!sidebar) {
      sidebar = doc.createElement("aside");
      sidebar.id = "gl-sidebar";
      sidebar.className = "gl-sidebar";
      sidebar.setAttribute("aria-label", "GitLab look navigation");
      doc.body.prepend(sidebar);
    }
    if (sidebar.dataset.key === key && sidebar.dataset.path === path) {
      markCurrent(sidebar, repo);
      return sidebar;
    }
    sidebar.dataset.key = key;
    sidebar.dataset.path = path;
    sidebar.replaceChildren();

    const rail = doc.createElement("div");
    rail.className = "gl-rail";
    const mark = doc.createElement("a");
    mark.className = "gl-mark";
    mark.href = "/";
    mark.setAttribute("aria-label", "Home");
    mark.textContent = "G";
    const search = doc.createElement("button");
    search.type = "button";
    search.className = "gl-rail-btn";
    search.setAttribute("aria-label", "Search");
    search.appendChild(
      icon(
        doc,
        "M11.5 7a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Zm-.82 4.74a6 6 0 1 1 1.06-1.06l3.04 3.04a.75.75 0 1 1-1.06 1.06l-3.04-3.04Z"
      )
    );
    search.addEventListener("click", () => focusSearch(doc));
    rail.append(mark, search);
    if (repo) {
      const owner = doc.createElement("a");
      owner.className = "gl-rail-btn";
      owner.href = "/" + repo.owner;
      owner.textContent = repo.owner.slice(0, 1).toUpperCase();
      owner.setAttribute("aria-label", repo.owner);
      rail.appendChild(owner);
    }
    sidebar.appendChild(rail);

    if (!repo) return sidebar;
    const context = doc.createElement("div");
    context.className = "gl-context";
    const project = doc.createElement("a");
    project.className = "gl-project";
    project.href = "/" + repo.owner + "/" + repo.repo;
    const ownerName = doc.createElement("span");
    ownerName.className = "gl-project-owner";
    ownerName.textContent = repo.owner;
    const repoName = doc.createElement("span");
    repoName.className = "gl-project-name";
    repoName.textContent = repo.repo;
    project.append(ownerName, repoName);
    const nav = doc.createElement("nav");
    nav.className = "gl-nav";
    nav.setAttribute("aria-label", "Project");
    const items = [
      ["repo", "Repository", ""],
      ["issues", "Issues", "/issues"],
      ["pulls", "Merge requests", "/pulls"],
      ["actions", "CI/CD", "/actions"],
    ];
    if (wiki === "1") items.push(["wiki", "Wiki", "/wiki"]);
    items.push(["insights", "Insights", "/pulse"], ["settings", "Settings", "/settings"]);
    items.forEach(([id, label, suffix]) => {
      const link = doc.createElement("a");
      link.dataset.section = id;
      link.href = "/" + repo.owner + "/" + repo.repo + suffix;
      const name = doc.createElement("span");
      name.className = "gl-nav-label";
      name.textContent = label;
      link.appendChild(name);
      const count = counts[id];
      if (count) {
        const badge = doc.createElement("span");
        badge.className = "gl-count";
        badge.textContent = count.text;
        badge.title = count.title;
        link.appendChild(badge);
        link.setAttribute("aria-label", label + ", " + count.title);
      }
      nav.appendChild(link);
    });
    context.append(project, nav);
    sidebar.appendChild(context);
    markCurrent(sidebar, repo);
    return sidebar;
  }

  function markCurrent(sidebar, repo) {
    if (!repo) return;
    const section = sectionFor(repo.rest);
    sidebar.querySelectorAll(".gl-nav a").forEach((link) => {
      if (link.dataset.section === section) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
  }

  function removeSidebar(doc) {
    const sidebar = doc.getElementById("gl-sidebar");
    if (sidebar) sidebar.remove();
  }

  function remapHeading(node) {
    const text = node.textContent.trim();
    if (text !== "Pull request" && text !== "Pull requests" && text !== "Actions") return;
    if (!node.dataset.glOriginal) node.dataset.glOriginal = text;
    if (text === "Actions") node.textContent = "CI/CD";
    else node.textContent = text.replace("Pull request", "Merge request");
  }

  function remapLabels(doc) {
    doc.querySelectorAll("h1, h2, .PageHeader-title").forEach((node) => {
      if (node.closest("#gl-sidebar")) return;
      remapHeading(node);
    });
    if (doc.title && /Pull [Rr]equests?/.test(doc.title)) {
      doc.documentElement.dataset.glTitle = doc.title;
      doc.title = doc.title.replace(/Pull [Rr]equests?/g, (match) =>
        /s$/i.test(match) ? "Merge requests" : "Merge request"
      );
    }
  }

  function restoreLabels(doc) {
    doc.querySelectorAll("[data-gl-original]").forEach((node) => {
      if (node.closest("#gl-pipeline-graph, #gl-job-bar, #gl-sidebar, #gl-mr-pipelines, #gl-mr-security")) return;
      const original = node.dataset.glOriginal;
      if (original === "Pull request" || original === "Pull requests" || original === "Actions") {
        node.textContent = original;
        delete node.dataset.glOriginal;
      }
    });
    const html = doc.documentElement;
    if (html.dataset.glTitle) {
      doc.title = html.dataset.glTitle;
      delete html.dataset.glTitle;
    }
  }

  function forceLight(doc, on) {
    const html = doc.documentElement;
    if (on) {
      if (html.dataset.glPrevColorMode === undefined) {
        html.dataset.glPrevColorMode = html.getAttribute("data-color-mode") || "";
      }
      html.setAttribute("data-color-mode", "light");
      return;
    }
    if (html.dataset.glPrevColorMode === undefined) return;
    if (html.dataset.glPrevColorMode) html.setAttribute("data-color-mode", html.dataset.glPrevColorMode);
    else html.removeAttribute("data-color-mode");
    delete html.dataset.glPrevColorMode;
  }

  function render(doc, nextSettings) {
    if (rendering) return;
    rendering = true;
    try {
      settings = nextSettings || settings;
      const enabled = settings.enabled !== false;
      const html = doc.documentElement;
      if (!enabled) {
        html.classList.remove("gl-look", "gl-look-repo");
        forceLight(doc, false);
        removeSidebar(doc);
        restoreLabels(doc);
        if (GL.clearPipeline) GL.clearPipeline(doc);
        const securityTab = doc.getElementById("gl-security-tab");
        if (securityTab) securityTab.remove();
        if (GL.restoreCommentOrder) GL.restoreCommentOrder(doc);
        if (GL.clearVulns) GL.clearVulns(doc);
        return;
      }
      html.classList.add("gl-look");
      forceLight(doc, true);
      const repo = parseRepo(GL.pagePath(doc));
      html.classList.toggle("gl-look-repo", Boolean(repo));
      if (doc.body) ensureSidebar(doc, repo);
      remapLabels(doc);
      if (GL.applyPipeline) GL.applyPipeline(doc);
      if (GL.applyCommentOrder) GL.applyCommentOrder(doc, settings.commentOrder || "asc");
      if (GL.applyVulns) GL.applyVulns(doc);
    } finally {
      rendering = false;
    }
  }

  function schedule() {
    if (rendering) return;
    readSettings().then((stored) => render(document, stored));
  }

  let queued = false;
  function queue() {
    if (queued || rendering) return;
    queued = true;
    const view = document.defaultView || window;
    view.requestAnimationFrame(() => {
      queued = false;
      schedule();
    });
  }

  function boot() {
    GL.saveCommentOrder = saveCommentOrder;
    readSettings().then((stored) => render(document, stored));
    document.addEventListener("turbo:load", queue);
    document.addEventListener("turbo:render", queue);
    window.addEventListener("popstate", queue);
    window.addEventListener("hashchange", queue);
    const observer = new MutationObserver(() => {
      if (!document.documentElement.classList.contains("gl-look")) return;
      queue();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    if (globalThis.chrome && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((message) => {
        if (!message || message.type !== "gl-look-settings") return;
        settings.enabled = message.enabled !== false;
        render(document, settings);
      });
    }
    if (globalThis.chrome && chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "local") return;
        if (changes.enabled) settings.enabled = changes.enabled.newValue !== false;
        if (changes.commentOrder) settings.commentOrder = changes.commentOrder.newValue || "asc";
        render(document, settings);
      });
    }
  }

  GL.readSettings = readSettings;
  GL.render = render;
  GL.parseRepo = parseRepo;
  GL.saveCommentOrder = saveCommentOrder;
  GL.requestRender = queue;

  const extension = globalThis.chrome && chrome.runtime && chrome.runtime.id;
  const autostart = document.documentElement.dataset.glAutostart === "true";
  if (extension || autostart) boot();
})();
