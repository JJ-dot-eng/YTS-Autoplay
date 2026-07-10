"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const popupSource = fs.readFileSync("popup.js", "utf8");

const messages = {
  htmlLang: "en",
  statusLoading: "Loading",
  statusSaving: "Saving",
  statusOn: "On",
  statusOff: "Off",
  storageLoadError: "Load failed: $1",
  storageSaveError: "Save failed: $1",
};

function createElement(initial = {}) {
  const listeners = new Map();

  return {
    checked: false,
    disabled: false,
    textContent: "",
    dataset: {},
    ...initial,
    addEventListener(type, listener) {
      const typeListeners = listeners.get(type) || [];
      typeListeners.push(listener);
      listeners.set(type, typeListeners);
    },
    dispatch(type) {
      for (const listener of listeners.get(type) || []) {
        listener({ type, target: this });
      }
    },
  };
}

function createHarness(options = {}) {
  const enabledInput = createElement({ checked: true, disabled: true });
  const statusText = createElement({
    textContent: "Unlocalized loading state",
    dataset: { i18n: "statusLoading" },
  });
  const getCalls = [];
  const setCalls = [];
  let getCallback;

  const runtime = { lastError: null };
  const chrome = {
    i18n: {
      getMessage(key, substitutions) {
        const template = messages[key] || key;
        if (substitutions === undefined) {
          return template;
        }

        const values = Array.isArray(substitutions)
          ? substitutions
          : [substitutions];
        return template.replace("$1", String(values[0]));
      },
    },
    runtime,
    storage: {
      local: {
        get(defaults, callback) {
          getCalls.push(defaults);
          getCallback = callback;
        },
        set(settings, callback) {
          setCalls.push({ settings, callback });
          if (options.setThrows) {
            throw options.setThrows;
          }
        },
      },
    },
  };

  const document = {
    documentElement: { lang: "" },
    getElementById(id) {
      if (id === "enabled") return enabledInput;
      if (id === "statusText") return statusText;
      throw new Error(`Unexpected element id: ${id}`);
    },
    querySelectorAll(selector) {
      assert.equal(selector, "[data-i18n]");
      return [statusText];
    },
  };

  vm.runInNewContext(popupSource, { chrome, document });

  return {
    document,
    enabledInput,
    statusText,
    getCalls,
    setCalls,
    resolveLoad(settings, lastError = null) {
      assert.equal(typeof getCallback, "function");
      runtime.lastError = lastError;
      getCallback(settings);
      runtime.lastError = null;
    },
    changeTo(nextEnabled) {
      enabledInput.checked = nextEnabled;
      enabledInput.dispatch("change");
    },
    resolveSave(index = 0, lastError = null) {
      const call = setCalls[index];
      assert.ok(call, `Missing storage.set call at index ${index}`);
      runtime.lastError = lastError;
      call.callback();
      runtime.lastError = null;
    },
  };
}

test("저장 설정을 불러오는 동안 로딩 상태이고 토글이 비활성화된다", () => {
  const harness = createHarness();

  assert.equal(harness.document.documentElement.lang, "en");
  assert.equal(harness.statusText.textContent, "Loading");
  assert.equal(harness.enabledInput.checked, true);
  assert.equal(harness.enabledInput.disabled, true);
  assert.equal(harness.getCalls.length, 1);
  assert.equal(JSON.stringify(harness.getCalls[0]), JSON.stringify({ enabled: true }));
});

test("불러온 true 설정을 토글과 상태 문구에 반영한다", () => {
  const harness = createHarness();

  harness.resolveLoad({ enabled: true });

  assert.equal(harness.enabledInput.checked, true);
  assert.equal(harness.enabledInput.disabled, false);
  assert.equal(harness.statusText.textContent, "On");
});

test("불러온 false 설정을 토글과 상태 문구에 반영한다", () => {
  const harness = createHarness();

  harness.resolveLoad({ enabled: false });

  assert.equal(harness.enabledInput.checked, false);
  assert.equal(harness.enabledInput.disabled, false);
  assert.equal(harness.statusText.textContent, "Off");
});

test("불러오기 lastError가 발생하면 안전하게 꺼짐 상태를 사용한다", () => {
  const harness = createHarness();

  harness.resolveLoad(undefined, { message: "read failed" });

  assert.equal(harness.enabledInput.checked, false);
  assert.equal(harness.enabledInput.disabled, false);
  assert.equal(harness.statusText.textContent, "Load failed: Off");
});

test("저장 성공 시 새 값을 확정하고 이후 복원 기준으로 사용한다", () => {
  const harness = createHarness();
  harness.resolveLoad({ enabled: false });

  harness.changeTo(true);

  assert.equal(harness.enabledInput.disabled, true);
  assert.equal(harness.statusText.textContent, "Saving");
  assert.equal(harness.setCalls.length, 1);
  assert.equal(harness.setCalls[0].settings.enabled, true);

  harness.resolveSave();

  assert.equal(harness.enabledInput.checked, true);
  assert.equal(harness.enabledInput.disabled, false);
  assert.equal(harness.statusText.textContent, "On");

  harness.changeTo(false);
  harness.resolveSave(1, { message: "second write failed" });

  assert.equal(harness.enabledInput.checked, true);
  assert.equal(harness.statusText.textContent, "Save failed: On");
});

test("저장 콜백의 lastError가 발생하면 이전 값으로 복원한다", () => {
  const harness = createHarness();
  harness.resolveLoad({ enabled: true });

  harness.changeTo(false);
  harness.resolveSave(0, { message: "write failed" });

  assert.equal(harness.enabledInput.checked, true);
  assert.equal(harness.enabledInput.disabled, false);
  assert.equal(harness.statusText.textContent, "Save failed: On");
});

test("storage.set이 동기적으로 예외를 던져도 이전 값으로 복원한다", () => {
  const harness = createHarness({ setThrows: new Error("set threw") });
  harness.resolveLoad({ enabled: false });

  harness.changeTo(true);

  assert.equal(harness.setCalls.length, 1);
  assert.equal(harness.enabledInput.checked, false);
  assert.equal(harness.enabledInput.disabled, false);
  assert.equal(harness.statusText.textContent, "Save failed: Off");
});

test("저장 중에는 토글을 비활성화하고 중복 변경을 저장하지 않는다", () => {
  const harness = createHarness();
  harness.resolveLoad({ enabled: false });

  harness.changeTo(true);

  assert.equal(harness.enabledInput.disabled, true);
  assert.equal(harness.setCalls.length, 1);

  harness.changeTo(false);

  assert.equal(harness.enabledInput.disabled, true);
  assert.equal(harness.enabledInput.checked, false);
  assert.equal(harness.setCalls.length, 1);

  harness.resolveSave();

  assert.equal(harness.enabledInput.checked, true);
  assert.equal(harness.enabledInput.disabled, false);
  assert.equal(harness.statusText.textContent, "On");
});
