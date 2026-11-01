const input = document.getElementById("enabled");
const themeInputs = Array.from(document.querySelectorAll('input[name="theme"]'));

function normalizeTheme(value) {
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

function selectedTheme() {
  const chosen = themeInputs.find((node) => node.checked);
  return normalizeTheme(chosen && chosen.value);
}

function applyPopupTheme(theme) {
  const choice = normalizeTheme(theme);
  const dark =
    choice === "dark" ||
    (choice === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("gl-popup-dark", dark);
}

function broadcast() {
  const enabled = input.checked;
  const theme = selectedTheme();
  applyPopupTheme(theme);
  chrome.storage.local.set({ enabled, theme });
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab || !tab.id) return;
    chrome.tabs.sendMessage(tab.id, { type: "gl-look-settings", enabled, theme }, () => {
      chrome.runtime.lastError;
    });
  });
}

chrome.storage.local.get({ enabled: true, theme: "system" }, (settings) => {
  input.checked = settings.enabled !== false;
  const theme = normalizeTheme(settings.theme);
  themeInputs.forEach((node) => {
    node.checked = node.value === theme;
  });
  applyPopupTheme(theme);
});

input.addEventListener("change", broadcast);
themeInputs.forEach((node) => node.addEventListener("change", broadcast));

const scheme = window.matchMedia("(prefers-color-scheme: dark)");
if (scheme.addEventListener) {
  scheme.addEventListener("change", () => {
    if (selectedTheme() === "system") applyPopupTheme("system");
  });
}
