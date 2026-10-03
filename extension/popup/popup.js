const input = document.getElementById("enabled");

chrome.storage.local.get({ enabled: true }, (settings) => {
  input.checked = settings.enabled !== false;
});

input.addEventListener("change", () => {
  const enabled = input.checked;
  chrome.storage.local.set({ enabled });
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab || !tab.id) return;
    chrome.tabs.sendMessage(tab.id, { type: "gl-look-settings", enabled }, () => {
      chrome.runtime.lastError;
    });
  });
});
