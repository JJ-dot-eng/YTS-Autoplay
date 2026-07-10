'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');

const CONTENT_SOURCE = readFileSync(`${__dirname}/../content.js`, 'utf8');
const LOGIC_SOURCE = readFileSync(`${__dirname}/../content-logic.js`, 'utf8');

function createRuntimeHarness({ pathname = '/shorts/test-short', videoState = {} } = {}) {
  const state = {
    storageGetCalls: 0,
    storageCallbacks: [],
    storageListeners: [],
    observerInstances: [],
    intervalSetCalls: [],
    intervalClearCalls: [],
    activeIntervals: new Map(),
    timeoutSetCalls: [],
    timeoutClearCalls: [],
    activeTimeouts: new Map(),
    animationFrameCalls: [],
    activeAnimationFrames: new Map(),
    nextClicks: 0,
    scrolls: 0,
  };

  let nextTimerId = 1;
  let nextAnimationFrameId = 1;

  class ElementMock {
    constructor(tagName, attributes = {}) {
      this.tagName = String(tagName).toUpperCase();
      this.attributes = new Map(Object.entries(attributes));
      this.children = [];
      this.parentElement = null;
      this.disabled = false;
      this.rect = {
        top: 0,
        left: 0,
        right: 640,
        bottom: 360,
        width: 640,
        height: 360,
      };
    }

    appendChild(child) {
      child.parentElement = this;
      this.children.push(child);
      return child;
    }

    getAttribute(name) {
      return this.attributes.has(name) ? this.attributes.get(name) : null;
    }

    getBoundingClientRect() {
      return { ...this.rect };
    }

    matches(selector) {
      if (selector === ':disabled') return this.disabled;
      if (selector === 'ytd-reel-video-renderer') {
        return this.tagName === 'YTD-REEL-VIDEO-RENDERER';
      }
      if (selector === "button, [role='button']") {
        return this.tagName === 'BUTTON' || this.getAttribute('role') === 'button';
      }
      return false;
    }

    closest(selector) {
      let current = this;

      while (current) {
        if (selector === 'ytd-shorts' && current.tagName === 'YTD-SHORTS') return current;
        if (
          selector === 'ytd-reel-video-renderer'
          && current.tagName === 'YTD-REEL-VIDEO-RENDERER'
        ) {
          return current;
        }
        current = current.parentElement;
      }

      return null;
    }

    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    }

    querySelectorAll(selector) {
      const descendants = [];
      const visit = (element) => {
        for (const child of element.children) {
          descendants.push(child);
          visit(child);
        }
      };
      visit(this);

      if (selector === 'video') {
        return descendants.filter((element) => element.tagName === 'VIDEO');
      }
      if (selector === 'ytd-shorts') {
        return descendants.filter((element) => element.tagName === 'YTD-SHORTS');
      }
      if (selector === 'ytd-reel-video-renderer[is-active]') {
        return descendants.filter((element) => (
          element.tagName === 'YTD-REEL-VIDEO-RENDERER'
          && element.attributes.has('is-active')
        ));
      }
      if (selector === '#navigation-button-down button') {
        const navigation = descendants.find(
          (element) => element.getAttribute('id') === 'navigation-button-down',
        );
        return navigation
          ? navigation.querySelectorAll('button')
          : [];
      }
      if (selector === 'button') {
        return descendants.filter((element) => element.tagName === 'BUTTON');
      }
      if (selector === 'button#navigation-button-down') {
        return descendants.filter((element) => (
          element.tagName === 'BUTTON'
          && element.getAttribute('id') === 'navigation-button-down'
        ));
      }
      if (selector === "[id='navigation-button-down'] [role='button']") {
        const navigation = descendants.find(
          (element) => element.getAttribute('id') === 'navigation-button-down',
        );
        return navigation
          ? navigation.querySelectorAll("[role='button']")
          : [];
      }
      if (selector === "[role='button']") {
        return descendants.filter((element) => element.getAttribute('role') === 'button');
      }
      if (selector === "button[aria-label], [role='button'][aria-label]") {
        return descendants.filter((element) => (
          (element.tagName === 'BUTTON' || element.getAttribute('role') === 'button')
          && element.getAttribute('aria-label') !== null
        ));
      }

      return [];
    }
  }

  class HTMLElementMock extends ElementMock {}

  class HTMLVideoElementMock extends HTMLElementMock {
    constructor() {
      super('video');
      this.currentTime = 10;
      this.duration = 10;
      this.ended = true;
      this.seeking = false;
      this.paused = false;
      this.currentSrc = 'https://example.test/video.mp4';
      this.src = this.currentSrc;
      this.listeners = new Map();
    }

    addEventListener(type, listener) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type).add(listener);
    }

    removeEventListener(type, listener) {
      this.listeners.get(type)?.delete(listener);
    }
  }

  class MutationObserverMock {
    constructor(callback) {
      this.callback = callback;
      this.observeCalls = [];
      this.disconnectCalls = 0;
      state.observerInstances.push(this);
    }

    observe(target, options) {
      this.observeCalls.push({ target, options });
    }

    disconnect() {
      this.disconnectCalls += 1;
    }
  }

  const documentElement = new HTMLElementMock('html');
  documentElement.clientHeight = 720;
  documentElement.clientWidth = 1280;

  const shortsRoot = documentElement.appendChild(new HTMLElementMock('ytd-shorts'));
  const activeRenderer = shortsRoot.appendChild(
    new HTMLElementMock('ytd-reel-video-renderer', { 'is-active': '' }),
  );
  const activeVideo = activeRenderer.appendChild(new HTMLVideoElementMock());
  Object.assign(activeVideo, videoState);
  const navigation = activeRenderer.appendChild(
    new HTMLElementMock('div', { id: 'navigation-button-down' }),
  );
  const nextButton = navigation.appendChild(
    new HTMLElementMock('button', { 'aria-label': 'Next' }),
  );
  nextButton.click = () => {
    state.nextClicks += 1;
  };

  const document = {
    documentElement,
    querySelector: (selector) => documentElement.querySelector(selector),
    querySelectorAll: (selector) => documentElement.querySelectorAll(selector),
  };

  const windowListeners = new Map();
  const window = {
    innerHeight: 720,
    innerWidth: 1280,
    getComputedStyle: () => ({
      visibility: 'visible',
      display: 'block',
      opacity: '1',
      pointerEvents: 'auto',
    }),
    addEventListener(type, listener) {
      if (!windowListeners.has(type)) windowListeners.set(type, new Set());
      windowListeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      windowListeners.get(type)?.delete(listener);
    },
    setInterval(callback, delay) {
      const id = nextTimerId;
      nextTimerId += 1;
      state.intervalSetCalls.push({ id, callback, delay });
      state.activeIntervals.set(id, { callback, delay });
      return id;
    },
    clearInterval(id) {
      state.intervalClearCalls.push(id);
      state.activeIntervals.delete(id);
    },
    setTimeout(callback, delay) {
      const id = nextTimerId;
      nextTimerId += 1;
      state.timeoutSetCalls.push({ id, callback, delay });
      state.activeTimeouts.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      state.timeoutClearCalls.push(id);
      state.activeTimeouts.delete(id);
    },
    requestAnimationFrame(callback) {
      const id = nextAnimationFrameId;
      nextAnimationFrameId += 1;
      state.animationFrameCalls.push({ id, callback });
      state.activeAnimationFrames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) {
      state.activeAnimationFrames.delete(id);
    },
  };

  const chrome = {
    runtime: {
      lastError: null,
      getManifest() {
        return { version: '0.6.2' };
      },
    },
    storage: {
      local: {
        get(defaults, callback) {
          state.storageGetCalls += 1;
          state.storageCallbacks.push({ defaults, callback });
        },
      },
      onChanged: {
        addListener(listener) {
          state.storageListeners.push(listener);
        },
        removeListener(listener) {
          const index = state.storageListeners.indexOf(listener);
          if (index >= 0) state.storageListeners.splice(index, 1);
        },
      },
    },
  };

  const context = vm.createContext({
    chrome,
    console,
    document,
    Element: ElementMock,
    HTMLElement: HTMLElementMock,
    HTMLVideoElement: HTMLVideoElementMock,
    location: { pathname },
    MutationObserver: MutationObserverMock,
    window,
  });

  vm.runInContext(LOGIC_SOURCE, context, { filename: 'content-logic.js' });

  function injectContentScript() {
    vm.runInContext(CONTENT_SOURCE, context, { filename: 'content.js' });
  }

  function respondToStorageGet(enabled) {
    const pending = state.storageCallbacks.shift();
    assert.ok(pending, '응답할 storage.get 콜백이 있어야 합니다.');
    pending.callback({ enabled });
  }

  function emitStorageChange(enabled) {
    for (const listener of state.storageListeners) {
      listener({ enabled: { newValue: enabled } }, 'local');
    }
  }

  function emitVideoEvent(type) {
    for (const listener of activeVideo.listeners.get(type) || []) {
      listener({ currentTarget: activeVideo });
    }
  }

  function emitWindowEvent(type) {
    for (const listener of windowListeners.get(type) || []) listener();
  }

  function flushAnimationFrames() {
    const frames = Array.from(state.activeAnimationFrames.entries());
    state.activeAnimationFrames.clear();
    for (const [, callback] of frames) callback();
  }

  function runNextTimeout() {
    const next = state.activeTimeouts.entries().next().value;
    assert.ok(next, '실행할 timeout이 있어야 합니다.');
    const [id, timer] = next;
    state.activeTimeouts.delete(id);
    timer.callback();
    return timer.delay;
  }

  return {
    activeVideo,
    context,
    emitVideoEvent,
    emitWindowEvent,
    emitStorageChange,
    flushAnimationFrames,
    injectContentScript,
    nextButton,
    respondToStorageGet,
    runNextTimeout,
    shortsRoot,
    state,
  };
}

test('storage.get 응답 전에는 감시, 타이머, 다음 영상 이동을 시작하지 않는다', () => {
  const harness = createRuntimeHarness();

  harness.injectContentScript();

  assert.equal(harness.state.storageGetCalls, 1);
  assert.equal(harness.state.observerInstances.length, 0);
  assert.equal(harness.state.intervalSetCalls.length, 0);
  assert.equal(harness.state.animationFrameCalls.length, 0);
  assert.equal(harness.state.nextClicks, 0);

  harness.respondToStorageGet(true);
  assert.equal(harness.state.nextClicks, 1);
});

test('저장된 설정이 false이면 런타임을 시작하지 않는다', () => {
  const harness = createRuntimeHarness();

  harness.injectContentScript();
  harness.respondToStorageGet(false);

  assert.equal(harness.state.observerInstances.length, 0);
  assert.equal(harness.state.intervalSetCalls.length, 0);
  assert.equal(harness.state.nextClicks, 0);
});

test('/watch 페이지에서는 설정이 true여도 런타임을 시작하지 않는다', () => {
  const harness = createRuntimeHarness({ pathname: '/watch' });

  harness.injectContentScript();
  harness.respondToStorageGet(true);

  assert.equal(harness.state.observerInstances.length, 0);
  assert.equal(harness.state.intervalSetCalls.length, 0);
  assert.equal(harness.state.nextClicks, 0);
});

test('/shorts/id 페이지에서는 observer 1개와 interval 2개만 생성한다', () => {
  const harness = createRuntimeHarness({ pathname: '/shorts/id' });

  harness.injectContentScript();
  harness.respondToStorageGet(true);

  assert.equal(harness.state.observerInstances.length, 1);
  assert.equal(harness.state.observerInstances[0].observeCalls.length, 1);
  assert.equal(harness.state.intervalSetCalls.length, 2);
  assert.deepEqual(
    harness.state.intervalSetCalls.map(({ delay }) => delay).sort((a, b) => a - b),
    [100, 500],
  );
  assert.equal(harness.state.activeIntervals.size, 2);
});

test('content.js를 10회 재주입해도 observer와 interval이 중복 생성되지 않는다', () => {
  const harness = createRuntimeHarness({ pathname: '/shorts/id' });

  harness.injectContentScript();
  harness.respondToStorageGet(true);

  for (let count = 0; count < 10; count += 1) {
    harness.injectContentScript();
  }

  assert.equal(harness.state.storageGetCalls, 1);
  assert.equal(harness.state.storageListeners.length, 1);
  assert.equal(harness.state.observerInstances.length, 1);
  assert.equal(harness.state.intervalSetCalls.length, 2);
  assert.equal(harness.state.activeIntervals.size, 2);
});

test('storage onChanged가 false를 알리면 observer와 interval을 모두 정리한다', () => {
  const harness = createRuntimeHarness({ pathname: '/shorts/id' });

  harness.injectContentScript();
  harness.respondToStorageGet(true);
  harness.emitStorageChange(false);

  assert.equal(harness.state.observerInstances.length, 1);
  assert.equal(harness.state.observerInstances[0].disconnectCalls, 1);
  assert.equal(harness.state.intervalClearCalls.length, 2);
  assert.equal(harness.state.activeIntervals.size, 0);
});

test('먼저 도착한 onChanged false를 늦은 storage.get true가 덮어쓰지 않는다', () => {
  const harness = createRuntimeHarness({ pathname: '/shorts/id' });

  harness.injectContentScript();
  harness.emitStorageChange(false);
  harness.respondToStorageGet(true);

  assert.equal(harness.state.observerInstances.length, 0);
  assert.equal(harness.state.intervalSetCalls.length, 0);
  assert.equal(harness.state.activeIntervals.size, 0);
  assert.equal(harness.state.nextClicks, 0);

  harness.context.window.__YTS_AUTOPLAY_CONTROLLER__.refresh();
  assert.equal(harness.state.observerInstances.length, 0);
  assert.equal(harness.state.intervalSetCalls.length, 0);
});

test('새 Short URL이 먼저 바뀌어도 이전 ended 영상으로 두 번 넘기지 않는다', () => {
  const harness = createRuntimeHarness({ pathname: '/shorts/first' });

  harness.injectContentScript();
  harness.respondToStorageGet(true);
  assert.equal(harness.state.nextClicks, 1);

  harness.context.location.pathname = '/shorts/second';
  harness.emitWindowEvent('yt-navigate-finish');
  harness.emitVideoEvent('ended');
  assert.equal(harness.state.nextClicks, 1);

  harness.flushAnimationFrames();
  harness.emitVideoEvent('ended');
  assert.equal(harness.state.nextClicks, 1);
});

test('URL 갱신 전 미디어가 바뀌면 즉시 재클릭하지 않고 새 진행 상태를 기다린다', () => {
  const harness = createRuntimeHarness({ pathname: '/shorts/first' });

  harness.injectContentScript();
  harness.respondToStorageGet(true);
  assert.equal(harness.state.nextClicks, 1);

  harness.activeVideo.currentSrc = 'https://example.test/next-video.mp4';
  harness.activeVideo.src = harness.activeVideo.currentSrc;
  assert.equal(harness.runNextTimeout(), 2000);
  assert.equal(harness.state.nextClicks, 1);

  harness.emitVideoEvent('ended');
  assert.equal(harness.state.nextClicks, 1);
});

test('전환 중 media source와 duration이 비어도 느린 URL 갱신으로 보고 재클릭하지 않는다', () => {
  const harness = createRuntimeHarness({ pathname: '/shorts/first' });

  harness.injectContentScript();
  harness.respondToStorageGet(true);
  assert.equal(harness.state.nextClicks, 1);

  harness.activeVideo.currentSrc = '';
  harness.activeVideo.src = '';
  harness.activeVideo.duration = 0;
  assert.equal(harness.runNextTimeout(), 2000);
  assert.equal(harness.state.nextClicks, 1);
  assert.equal(harness.state.activeTimeouts.size, 0);
});

test('첫 검증 뒤 재시도 backoff 중 미디어가 바뀌어도 재클릭하지 않는다', () => {
  const harness = createRuntimeHarness({ pathname: '/shorts/first' });

  harness.injectContentScript();
  harness.respondToStorageGet(true);
  assert.equal(harness.state.nextClicks, 1);

  assert.equal(harness.runNextTimeout(), 2000);
  harness.activeVideo.currentSrc = 'https://example.test/late-next-video.mp4';
  harness.activeVideo.src = harness.activeVideo.currentSrc;
  assert.equal(harness.runNextTimeout(), 750);

  assert.equal(harness.state.nextClicks, 1);
  assert.equal(harness.state.activeTimeouts.size, 0);
});

test('수동 seek 이벤트는 관찰 진행을 초기화해 반복 오인 이동을 막는다', () => {
  const harness = createRuntimeHarness({
    pathname: '/shorts/first',
    videoState: { currentTime: 5, duration: 10, ended: false, paused: false },
  });

  harness.injectContentScript();
  harness.respondToStorageGet(true);
  assert.equal(harness.state.nextClicks, 0);

  harness.activeVideo.currentTime = 9.4;
  harness.emitVideoEvent('timeupdate');
  harness.activeVideo.currentTime = 0.05;
  harness.emitVideoEvent('seeking');
  harness.emitVideoEvent('seeked');
  harness.emitVideoEvent('timeupdate');

  assert.equal(harness.state.nextClicks, 0);
});

test('이동 버튼이 늦게 생겨도 제한된 탐색 재시도로 다시 시도한다', () => {
  const harness = createRuntimeHarness({ pathname: '/shorts/first' });
  harness.nextButton.disabled = true;

  harness.injectContentScript();
  harness.respondToStorageGet(true);
  assert.equal(harness.state.nextClicks, 0);

  harness.nextButton.disabled = false;
  assert.equal(harness.runNextTimeout(), 1000);
  assert.equal(harness.state.nextClicks, 1);
});

test('이동 수단 탐색은 최대 횟수 뒤 종료되고 종료 이벤트가 반복돼도 다시 예약하지 않는다', () => {
  const harness = createRuntimeHarness({ pathname: '/shorts/first' });
  harness.nextButton.disabled = true;

  harness.injectContentScript();
  harness.respondToStorageGet(true);

  while (harness.state.activeTimeouts.size > 0) harness.runNextTimeout();
  assert.equal(harness.state.timeoutSetCalls.length, 5);
  assert.equal(harness.state.nextClicks, 0);

  for (let count = 0; count < 10; count += 1) harness.emitVideoEvent('ended');
  assert.equal(harness.state.timeoutSetCalls.length, 5);
  assert.equal(harness.state.activeTimeouts.size, 0);
  assert.equal(harness.state.nextClicks, 0);
});

test('이동 수단 탐색 backoff 중 미디어가 바뀌면 다음 클릭을 중단한다', () => {
  const harness = createRuntimeHarness({ pathname: '/shorts/first' });
  harness.nextButton.disabled = true;

  harness.injectContentScript();
  harness.respondToStorageGet(true);
  assert.equal(harness.state.nextClicks, 0);

  harness.activeVideo.currentSrc = 'https://example.test/late-next-video.mp4';
  harness.activeVideo.src = harness.activeVideo.currentSrc;
  harness.nextButton.disabled = false;
  assert.equal(harness.runNextTimeout(), 1000);

  assert.equal(harness.state.nextClicks, 0);
  assert.equal(harness.state.activeTimeouts.size, 0);
});

test('버튼이 없으면 Shorts 내부 스크롤 컨테이너만 대체 이동에 사용한다', () => {
  const harness = createRuntimeHarness({ pathname: '/shorts/first' });
  harness.nextButton.disabled = true;
  harness.shortsRoot.clientHeight = 900;
  harness.shortsRoot.scrollHeight = 1800;
  harness.shortsRoot.scrollBy = () => {
    harness.state.scrolls += 1;
  };

  harness.injectContentScript();
  harness.respondToStorageGet(true);

  assert.equal(harness.state.nextClicks, 0);
  assert.equal(harness.state.scrolls, 1);
});

test('기존 controller의 refresh와 destroy가 모두 실패해도 새 controller를 설치한다', () => {
  const harness = createRuntimeHarness();
  const staleController = {
    version: '0.6.2',
    refresh() {
      throw new Error('Extension context invalidated');
    },
    destroy() {
      throw new Error('Extension context invalidated');
    },
  };
  harness.context.window.__YTS_AUTOPLAY_CONTROLLER__ = staleController;

  assert.doesNotThrow(() => harness.injectContentScript());
  assert.notEqual(harness.context.window.__YTS_AUTOPLAY_CONTROLLER__, staleController);
  assert.equal(harness.state.storageGetCalls, 1);
});
