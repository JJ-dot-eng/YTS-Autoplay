(() => {
  "use strict";

  const STORAGE_KEY = "enabled";
  const enabledInput = document.getElementById("enabled");
  const statusText = document.getElementById("statusText");
  let savedEnabled = true;
  let savePending = false;

  function message(key, substitutions) {
    return chrome.i18n.getMessage(key, substitutions) || key;
  }

  function localizeStaticText() {
    document.documentElement.lang = message("htmlLang");
    document.querySelectorAll("[data-i18n]").forEach((element) => {
      element.textContent = message(element.dataset.i18n);
    });
  }

  function render(enabled, statusKey = enabled ? "statusOn" : "statusOff", substitutions) {
    enabledInput.checked = enabled;
    statusText.textContent = message(statusKey, substitutions);
  }

  function finishLoad(settings, error) {
    if (error) {
      savedEnabled = false;
      render(savedEnabled, "storageLoadError", message("statusOff"));
    } else {
      savedEnabled = settings[STORAGE_KEY] !== false;
      render(savedEnabled);
    }

    enabledInput.disabled = false;
  }

  function loadSetting() {
    try {
      chrome.storage.local.get({ [STORAGE_KEY]: true }, (settings) => {
        finishLoad(settings, chrome.runtime.lastError);
      });
    } catch (error) {
      finishLoad({}, error);
    }
  }

  function finishSave(nextEnabled, previousEnabled, error) {
    savePending = false;
    enabledInput.disabled = false;

    if (error) {
      savedEnabled = previousEnabled;
      render(
        savedEnabled,
        "storageSaveError",
        message(savedEnabled ? "statusOn" : "statusOff")
      );
      return;
    }

    savedEnabled = nextEnabled;
    render(savedEnabled);
  }

  localizeStaticText();
  loadSetting();

  enabledInput.addEventListener("change", () => {
    if (savePending) {
      render(savedEnabled);
      return;
    }

    const nextEnabled = enabledInput.checked;
    const previousEnabled = savedEnabled;

    savePending = true;
    enabledInput.disabled = true;
    render(nextEnabled, "statusSaving");

    try {
      chrome.storage.local.set({ [STORAGE_KEY]: nextEnabled }, () => {
        finishSave(nextEnabled, previousEnabled, chrome.runtime.lastError);
      });
    } catch (error) {
      finishSave(nextEnabled, previousEnabled, error);
    }
  });
})();
