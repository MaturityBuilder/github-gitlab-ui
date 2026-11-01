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

  function normalizeTheme(value) {
    return value === "light" || value === "dark" || value === "system" ? value : "system";
  }

  function parseRepo(path) {
    const parts = String(path || "").split("/").filter(Boolean);
    if (parts.length < 2) return null;
    if (RESERVED.has(parts[0])) return null;
    return { owner: parts[0], repo: parts[1], rest: parts.slice(2).join("/") };
  }

  function prefersDark(doc) {
    const view = (doc && doc.defaultView) || globalThis;
    if (!view.matchMedia) return false;
    return view.matchMedia("(prefers-color-scheme: dark)").matches;
  }

  function resolvedTheme(theme, doc) {
    const choice = normalizeTheme(theme);
    if (choice === "system") return prefersDark(doc) ? "dark" : "light";
    return choice;
  }

  function readFastSettings() {
    let enabled = true;
    let theme = "system";
    let commentOrder = "asc";
    try {
      if (localStorage.getItem("gl-enabled") === "false") enabled = false;
      theme = localStorage.getItem("gl-theme") || "system";
      commentOrder = localStorage.getItem("gl-comment-order") === "desc" ? "desc" : "asc";
    } catch (error) {
      enabled = true;
    }
    return { enabled: enabled, theme: normalizeTheme(theme), commentOrder: commentOrder };
  }

  function rememberSettings(settings) {
    try {
      localStorage.setItem("gl-enabled", settings.enabled === false ? "false" : "true");
      localStorage.setItem("gl-theme", normalizeTheme(settings.theme));
      if (settings.commentOrder) {
        localStorage.setItem("gl-comment-order", settings.commentOrder === "desc" ? "desc" : "asc");
      }
    } catch (error) {
      /* private windows can reject storage */
    }
  }

  const html = document.documentElement;
  let pinned = null;
  let locked = false;
  let nativeSet = html.setAttribute;
  let nativeRemove = html.removeAttribute;

  function installLock() {
    if (locked) return;
    locked = true;
    nativeSet = html.setAttribute;
    nativeRemove = html.removeAttribute;
    html.setAttribute = function (name, value) {
      if (pinned && name === "data-color-mode") return nativeSet.call(this, name, pinned);
      return nativeSet.call(this, name, value);
    };
    html.removeAttribute = function (name) {
      if (pinned && name === "data-color-mode") return;
      return nativeRemove.call(this, name);
    };
    const origToggle = html.toggleAttribute;
    if (origToggle) {
      html.toggleAttribute = function (name, force) {
        if (pinned && name === "data-color-mode") {
          nativeSet.call(this, name, pinned);
          return true;
        }
        return origToggle.call(this, name, force);
      };
    }
    // dataset.colorMode writes the attribute from C++, bypassing the method above.
    // The observer runs before the next paint and puts the skin mode back.
    const observer = new MutationObserver(function () {
      if (!pinned) return;
      if (html.getAttribute("data-color-mode") !== pinned) nativeSet.call(html, "data-color-mode", pinned);
      if (!html.classList.contains("gl-look")) html.classList.add("gl-look");
      html.classList.toggle("gl-look-dark", pinned === "dark");
    });
    observer.observe(html, { attributes: true, attributeFilter: ["data-color-mode", "class"] });
  }

  function applyFastTheme(settings, options) {
    const doc = (options && options.doc) || document;
    const root = doc.documentElement;
    const enabled = !settings || settings.enabled !== false;
    if (!enabled) {
      pinned = null;
      root.classList.remove("gl-look", "gl-look-dark");
      return;
    }
    const mode = resolvedTheme(settings.theme, doc);
    if (root.dataset.glPrevColorMode === undefined) {
      root.dataset.glPrevColorMode = root.getAttribute("data-color-mode") || "";
    }
    pinned = mode;
    installLock();
    root.classList.add("gl-look");
    root.classList.toggle("gl-look-dark", mode === "dark");
    root.setAttribute("data-color-mode", mode);
    if (options && Object.prototype.hasOwnProperty.call(options, "repoClass")) {
      root.classList.toggle("gl-look-repo", Boolean(options.repoClass));
    }
  }

  GL.normalizeTheme = GL.normalizeTheme || normalizeTheme;
  GL.resolvedTheme = GL.resolvedTheme || resolvedTheme;
  GL.parseRepo = GL.parseRepo || parseRepo;
  GL.readFastSettings = readFastSettings;
  GL.rememberSettings = rememberSettings;
  GL.applyFastTheme = applyFastTheme;

  const extension = globalThis.chrome && chrome.runtime && chrome.runtime.id;
  if (!extension) return;

  html.dataset.glBoot = document.body ? "late" : "early";
  const fast = readFastSettings();
  applyFastTheme(fast, { repoClass: Boolean(parseRepo(location.pathname)) });

  const area = chrome.storage && chrome.storage.local;
  if (area) {
    area.get({ enabled: true, theme: "system", commentOrder: "asc" }, function (stored) {
      const settings = {
        enabled: !stored || stored.enabled !== false,
        theme: normalizeTheme(stored && stored.theme),
        commentOrder: stored && stored.commentOrder === "desc" ? "desc" : "asc",
      };
      rememberSettings(settings);
      applyFastTheme(settings, { repoClass: Boolean(parseRepo(location.pathname)) });
    });
  }

  window.addEventListener("pageshow", function (event) {
    if (!event.persisted) return;
    const cached = readFastSettings();
    applyFastTheme(cached, { repoClass: Boolean(parseRepo(location.pathname)) });
  });
})();
