(() => {
  "use strict";

  const STORAGE_KEY = "enabled";
  const enabledInput = document.getElementById("enabled");
  const statusText = document.getElementById("statusText");

  function render(enabled) {
    enabledInput.checked = enabled;
    statusText.textContent = enabled ? "켜짐" : "꺼짐";
  }

  chrome.storage.local.get({ [STORAGE_KEY]: true }, (settings) => {
    render(settings[STORAGE_KEY] !== false);
  });

  enabledInput.addEventListener("change", () => {
    const enabled = enabledInput.checked;
    render(enabled);
    chrome.storage.local.set({ [STORAGE_KEY]: enabled });
  });
})();
