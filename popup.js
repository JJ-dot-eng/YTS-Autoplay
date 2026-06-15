(() => {
  "use strict";

  const STORAGE_KEY = "enabled";
  const enabledInput = document.getElementById("enabled");
  const statusText = document.getElementById("statusText");

  function message(key) {
    return chrome.i18n.getMessage(key) || key;
  }

  function localizeStaticText() {
    document.documentElement.lang = message("htmlLang");
    document.querySelectorAll("[data-i18n]").forEach((element) => {
      element.textContent = message(element.dataset.i18n);
    });
  }

  function render(enabled) {
    enabledInput.checked = enabled;
    statusText.textContent = enabled ? message("statusOn") : message("statusOff");
  }

  localizeStaticText();

  chrome.storage.local.get({ [STORAGE_KEY]: true }, (settings) => {
    render(settings[STORAGE_KEY] !== false);
  });

  enabledInput.addEventListener("change", () => {
    const enabled = enabledInput.checked;
    render(enabled);
    chrome.storage.local.set({ [STORAGE_KEY]: enabled });
  });
})();
