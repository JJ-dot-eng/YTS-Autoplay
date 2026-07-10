(() => {
  "use strict";

  const CONTROLLER_KEY = "__YTS_AUTOPLAY_CONTROLLER__";
  let controllerVersion = "unknown";
  try {
    controllerVersion = chrome.runtime?.getManifest?.().version || controllerVersion;
  } catch {
    // A stale extension context cannot provide its manifest. A fresh injection will replace it.
  }
  const CONTROLLER_VERSION = controllerVersion;
  const existingController = window[CONTROLLER_KEY];

  if (
    existingController?.version === CONTROLLER_VERSION
    && typeof existingController.refresh === "function"
  ) {
    try {
      existingController.refresh();
      return;
    } catch {
      // A stale extension context may throw. Replace it with a fresh controller below.
    }
  }

  if (existingController && typeof existingController.destroy === "function") {
    try {
      existingController.destroy();
    } catch {
      // Cleanup failure must not block a fresh content-script injection.
    }
  }

  const logic = globalThis.YTSAutoplayLogic;
  if (!logic) return;

  const controller = {
    version: CONTROLLER_VERSION,
    refresh() {},
    destroy() {}
  };
  window[CONTROLLER_KEY] = controller;

  const SCAN_INTERVAL_MS = 500;
  const PROGRESS_CHECK_INTERVAL_MS = 100;
  const END_THRESHOLD_SECONDS = 0.2;
  const LOOP_PREVIOUS_NEAR_END_SECONDS = 0.75;
  const NEXT_COOLDOWN_MS = 900;
  const ADVANCE_VERIFY_DELAY_MS = 2000;
  const ADVANCE_TRANSITION_GRACE_MS = 1000;
  const ADVANCE_RETRY_BACKOFF_MS = 750;
  const ADVANCE_DISCOVERY_RETRY_MS = 1000;
  const MAX_ADVANCE_ATTEMPTS_PER_SHORT = 3;
  const MAX_ADVANCE_DISCOVERY_FAILURES = 6;
  const STORAGE_KEY = "enabled";

  let activeVideo = null;
  let activeShortId = "";
  let observedVideo = null;
  let observedVideoTime = 0;
  let observedVideoDuration = 0;
  let progressArmed = false;
  let isEnabled = null;
  let settingRevision = 0;
  let settingReadFailed = false;
  let runtimeActive = false;
  let observer = null;
  let scanInterval = 0;
  let progressInterval = 0;
  let scanAnimationFrame = 0;
  let destroyed = false;

  const advanceState = {
    shortId: "",
    attempts: 0,
    discoveryFailures: 0,
    pending: false,
    generation: 0,
    verifyTimer: 0,
    retryTimer: 0,
    lastActionAt: 0
  };

  function getStorageLocal() {
    if (typeof chrome === "undefined" || !chrome.storage?.local) return null;
    return chrome.storage.local;
  }

  function getStorageChanges() {
    if (typeof chrome === "undefined" || !chrome.storage?.onChanged) return null;
    return chrome.storage.onChanged;
  }

  function getRuntimeLastError() {
    try {
      return chrome.runtime?.lastError || null;
    } catch {
      return null;
    }
  }

  function isShortsPage() {
    return logic.isShortsPath(location.pathname);
  }

  function getShortId() {
    return logic.getShortIdFromPath(location.pathname) || "";
  }

  function isRenderedElement(element) {
    if (!(element instanceof Element)) return false;
    if (element.getAttribute("aria-hidden") === "true") return false;

    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;

    if (rect.width <= 0 || rect.height <= 0) return false;
    if (rect.bottom <= 0 || rect.right <= 0) return false;
    if (rect.top >= viewportHeight || rect.left >= viewportWidth) return false;
    if (style.visibility === "hidden" || style.display === "none") return false;
    if (Number.parseFloat(style.opacity || "1") === 0) return false;

    return true;
  }

  function isVisibleVideo(video) {
    return video instanceof HTMLVideoElement && isRenderedElement(video);
  }

  function getVisibleArea(element) {
    const rect = element.getBoundingClientRect();
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const visibleWidth = Math.max(0, Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0));
    const visibleHeight = Math.max(0, Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0));

    return visibleWidth * visibleHeight;
  }

  function findLargestVisibleVideo(root) {
    if (!root) return null;

    return Array.from(root.querySelectorAll("video"))
      .filter(isVisibleVideo)
      .sort((first, second) => getVisibleArea(second) - getVisibleArea(first))[0] || null;
  }

  function findActiveVideo() {
    const activeRenderer = document.querySelector("ytd-reel-video-renderer[is-active]");
    const shortsRoot = activeRenderer?.closest("ytd-shorts") || document.querySelector("ytd-shorts");

    return findLargestVisibleVideo(activeRenderer)
      || findLargestVisibleVideo(shortsRoot)
      || findLargestVisibleVideo(document);
  }

  function getFiniteDuration(video) {
    return Number.isFinite(video?.duration) ? video.duration : 0;
  }

  function resetObservedVideoProgress(video) {
    observedVideo = video || null;
    observedVideoTime = video?.currentTime || 0;
    observedVideoDuration = video ? getFiniteDuration(video) : 0;
  }

  function rememberVideoProgress(video) {
    observedVideo = video;
    observedVideoTime = video.currentTime || 0;
    observedVideoDuration = getFiniteDuration(video);
  }

  function didActiveVideoLoop(video) {
    if (!video || video !== observedVideo) return false;

    return logic.didPlaybackLoop({
      currentTime: video.currentTime || 0,
      previousTime: observedVideoTime,
      duration: getFiniteDuration(video),
      previousDuration: observedVideoDuration,
      isSeeking: video.seeking
    }, LOOP_PREVIOUS_NEAR_END_SECONDS);
  }

  function clearAdvanceTimers() {
    if (advanceState.verifyTimer) {
      window.clearTimeout(advanceState.verifyTimer);
      advanceState.verifyTimer = 0;
    }

    if (advanceState.retryTimer) {
      window.clearTimeout(advanceState.retryTimer);
      advanceState.retryTimer = 0;
    }
  }

  function resetAdvanceState(shortId = "") {
    clearAdvanceTimers();
    advanceState.shortId = shortId;
    advanceState.attempts = 0;
    advanceState.discoveryFailures = 0;
    advanceState.pending = false;
    advanceState.generation += 1;
    advanceState.lastActionAt = 0;
  }

  function isClickableElement(element) {
    if (!(element instanceof HTMLElement)) return false;
    if (element.matches(":disabled") || element.getAttribute("aria-disabled") === "true") return false;
    if (window.getComputedStyle(element).pointerEvents === "none") return false;

    return isRenderedElement(element);
  }

  function isNextButtonLabel(label) {
    return /next/i.test(label) || label.includes("\uB2E4\uC74C");
  }

  function isPreviousButtonLabel(label) {
    return /previous|prev/i.test(label) || label.includes("\uC774\uC804");
  }

  function normalizeButtonCandidate(element) {
    if (!element) return null;
    if (element.matches?.("button, [role='button']")) return element;
    return element.querySelector?.("button, [role='button']") || null;
  }

  function findNextButton() {
    const activeRenderer = activeVideo?.closest("ytd-reel-video-renderer")
      || document.querySelector("ytd-reel-video-renderer[is-active]");
    const shortsRoot = activeRenderer?.closest("ytd-shorts") || document.querySelector("ytd-shorts");
    const scopedRoots = Array.from(new Set([
      activeRenderer,
      shortsRoot,
      activeRenderer?.parentElement
    ].filter(Boolean)));

    const structuralSelectors = [
      "#navigation-button-down button",
      "button#navigation-button-down",
      "[id='navigation-button-down'] [role='button']"
    ];

    for (const root of scopedRoots) {
      for (const selector of structuralSelectors) {
        const candidate = normalizeButtonCandidate(root.querySelector(selector));
        if (!isClickableElement(candidate)) continue;

        const label = candidate.getAttribute("aria-label") || "";
        if (!isPreviousButtonLabel(label)) return candidate;
      }
    }

    for (const root of scopedRoots) {
      const buttons = Array.from(root.querySelectorAll("button[aria-label], [role='button'][aria-label]"));
      const nextButton = buttons.find((button) => {
        const label = button.getAttribute("aria-label") || "";
        return isNextButtonLabel(label) && !isPreviousButtonLabel(label) && isClickableElement(button);
      });

      if (nextButton) return nextButton;
    }

    return null;
  }

  function scrollToNextShort() {
    const activeRenderer = activeVideo?.closest("ytd-reel-video-renderer")
      || document.querySelector("ytd-reel-video-renderer[is-active]");
    if (!activeRenderer) return false;

    const shortsRoot = activeRenderer.closest("ytd-shorts") || document.querySelector("ytd-shorts");
    const renderers = Array.from(shortsRoot?.querySelectorAll("ytd-reel-video-renderer") || []);
    const activeIndex = renderers.indexOf(activeRenderer);
    const nextRenderer = activeIndex >= 0 ? renderers[activeIndex + 1] : null;

    if (nextRenderer && typeof nextRenderer.scrollIntoView === "function") {
      nextRenderer.scrollIntoView({
        behavior: "auto",
        block: "start"
      });
      return true;
    }

    const scopedTargets = Array.from(new Set([
      activeRenderer.parentElement,
      shortsRoot?.querySelector("#shorts-container"),
      shortsRoot
    ].filter(Boolean)));
    const distance = window.innerHeight || document.documentElement.clientHeight || 800;

    for (const target of scopedTargets) {
      if (typeof target.scrollBy !== "function") continue;
      if (!Number.isFinite(target.scrollHeight) || !Number.isFinite(target.clientHeight)) continue;
      if (target.scrollHeight <= target.clientHeight) continue;

      target.scrollBy({ top: distance, behavior: "auto" });
      return true;
    }

    return false;
  }

  function captureVideoSnapshot(video) {
    return {
      element: video || null,
      source: video?.currentSrc || video?.src || "",
      duration: getFiniteDuration(video)
    };
  }

  function didVideoSnapshotChange(previous, current) {
    if (previous.element !== current.element && (previous.element || current.element)) return true;
    if (previous.source !== current.source && (previous.source || current.source)) return true;

    const previousHasDuration = Number.isFinite(previous.duration) && previous.duration > 0;
    const currentHasDuration = Number.isFinite(current.duration) && current.duration > 0;
    if (previousHasDuration !== currentHasDuration) return true;

    return previousHasDuration
      && currentHasDuration
      && Math.abs(previous.duration - current.duration) > 0.25;
  }

  function waitForMediaAfterUnconfirmedTransition(shortId, videoSnapshot) {
    resetAdvanceState(shortId);
    progressArmed = false;
    resetObservedVideoProgress(videoSnapshot.element);
    bindVideo(videoSnapshot.element);
    requestScan();
  }

  function scheduleAdvanceRetry(shortId, generation, videoSnapshot) {
    if (advanceState.attempts >= MAX_ADVANCE_ATTEMPTS_PER_SHORT) return;

    const delay = ADVANCE_RETRY_BACKOFF_MS * Math.max(1, advanceState.attempts);
    advanceState.retryTimer = window.setTimeout(() => {
      advanceState.retryTimer = 0;

      if (generation !== advanceState.generation) return;
      if (!runtimeActive || isEnabled !== true || getShortId() !== shortId) return;

      const currentSnapshot = captureVideoSnapshot(findActiveVideo());
      if (didVideoSnapshotChange(videoSnapshot, currentSnapshot)) {
        waitForMediaAfterUnconfirmedTransition(shortId, currentSnapshot);
        return;
      }

      advanceState.lastActionAt = 0;
      advanceToNextShort();
    }, delay);
  }

  function scheduleAdvanceDiscovery(shortId, generation, videoSnapshot) {
    if (advanceState.discoveryFailures >= MAX_ADVANCE_DISCOVERY_FAILURES) return;

    const delay = ADVANCE_DISCOVERY_RETRY_MS * Math.max(1, advanceState.discoveryFailures);
    advanceState.retryTimer = window.setTimeout(() => {
      advanceState.retryTimer = 0;

      if (generation !== advanceState.generation) return;
      if (!runtimeActive || isEnabled !== true || getShortId() !== shortId) return;

      const currentSnapshot = captureVideoSnapshot(findActiveVideo());
      if (didVideoSnapshotChange(videoSnapshot, currentSnapshot)) {
        waitForMediaAfterUnconfirmedTransition(shortId, currentSnapshot);
        return;
      }

      advanceState.lastActionAt = 0;
      advanceToNextShort();
    }, delay);
  }

  function scheduleAdvanceVerification(shortId, videoSnapshot, generation, allowTransitionGrace = true) {
    if (advanceState.verifyTimer) window.clearTimeout(advanceState.verifyTimer);

    const delay = allowTransitionGrace ? ADVANCE_VERIFY_DELAY_MS : ADVANCE_TRANSITION_GRACE_MS;
    advanceState.verifyTimer = window.setTimeout(() => {
      advanceState.verifyTimer = 0;

      if (generation !== advanceState.generation) return;
      if (!runtimeActive || isEnabled !== true || !isShortsPage()) {
        advanceState.pending = false;
        return;
      }

      const currentShortId = getShortId();
      if (logic.didShortChange(shortId, currentShortId)) {
        advanceState.pending = false;
        requestScan();
        return;
      }

      if (!currentShortId) {
        if (allowTransitionGrace) {
          scheduleAdvanceVerification(shortId, videoSnapshot, generation, false);
        } else {
          advanceState.pending = false;
        }
        return;
      }

      const currentSnapshot = captureVideoSnapshot(findActiveVideo());
      if (allowTransitionGrace && didVideoSnapshotChange(videoSnapshot, currentSnapshot)) {
        waitForMediaAfterUnconfirmedTransition(shortId, currentSnapshot);
        return;
      }

      advanceState.pending = false;
      scheduleAdvanceRetry(shortId, generation, currentSnapshot);
    }, delay);
  }

  function performAdvanceAction() {
    const nextButton = findNextButton();
    if (nextButton) {
      try {
        nextButton.click();
        return true;
      } catch {
        return false;
      }
    }

    return scrollToNextShort();
  }

  function advanceToNextShort() {
    if (!runtimeActive || isEnabled !== true || !isShortsPage() || !progressArmed) return;

    const shortId = getShortId();
    if (!shortId || shortId !== activeShortId) {
      requestScan();
      return;
    }

    if (advanceState.shortId !== shortId) resetAdvanceState(shortId);
    if (advanceState.pending || advanceState.retryTimer) return;
    if (advanceState.attempts >= MAX_ADVANCE_ATTEMPTS_PER_SHORT) return;
    if (advanceState.discoveryFailures >= MAX_ADVANCE_DISCOVERY_FAILURES) return;

    const now = Date.now();
    if (now - advanceState.lastActionAt < NEXT_COOLDOWN_MS) return;

    const videoSnapshot = captureVideoSnapshot(activeVideo);
    if (!performAdvanceAction()) {
      advanceState.discoveryFailures += 1;
      advanceState.lastActionAt = now;
      scheduleAdvanceDiscovery(shortId, advanceState.generation, videoSnapshot);
      return;
    }

    advanceState.discoveryFailures = 0;
    advanceState.attempts += 1;
    advanceState.pending = true;
    advanceState.lastActionAt = now;
    scheduleAdvanceVerification(shortId, videoSnapshot, advanceState.generation);
  }

  function isVideoNearEnd(video) {
    return logic.isVideoNearEndSnapshot({
      duration: getFiniteDuration(video),
      currentTime: video?.currentTime
    }, END_THRESHOLD_SECONDS);
  }

  function canArmProgress(video) {
    if (!video || video.ended || video.seeking) return false;
    if (getFiniteDuration(video) < 0.5 || !Number.isFinite(video.currentTime)) return false;
    return !isVideoNearEnd(video);
  }

  function shouldAdvanceVideo(video) {
    if (!progressArmed) {
      rememberVideoProgress(video);
      if (canArmProgress(video)) progressArmed = true;
      return false;
    }

    if (video.seeking || (video.paused && !video.ended)) {
      rememberVideoProgress(video);
      return false;
    }

    const shouldAdvance = video.ended || isVideoNearEnd(video) || didActiveVideoLoop(video);
    rememberVideoProgress(video);
    return shouldAdvance;
  }

  function handleEnded(event) {
    if (!progressArmed || event.currentTarget !== activeVideo) return;
    advanceToNextShort();
  }

  function handleSeeking(event) {
    const video = event.currentTarget;
    if (video !== activeVideo) return;

    progressArmed = false;
    resetObservedVideoProgress(video);
  }

  function handleSeeked(event) {
    const video = event.currentTarget;
    if (video !== activeVideo) return;

    resetObservedVideoProgress(video);
  }

  function handleTimeUpdate(event) {
    const video = event.currentTarget;
    if (video !== activeVideo || !shouldAdvanceVideo(video)) return;
    advanceToNextShort();
  }

  function checkActiveVideoProgress() {
    if (!runtimeActive || !activeVideo || !shouldAdvanceVideo(activeVideo)) return;
    advanceToNextShort();
  }

  function unbindActiveVideo() {
    if (!activeVideo) return;

    activeVideo.removeEventListener("ended", handleEnded);
    activeVideo.removeEventListener("timeupdate", handleTimeUpdate);
    activeVideo.removeEventListener("seeking", handleSeeking);
    activeVideo.removeEventListener("seeked", handleSeeked);
    activeVideo = null;
    resetObservedVideoProgress(null);
  }

  function bindVideo(video) {
    if (!video) {
      unbindActiveVideo();
      return;
    }
    if (video === activeVideo) return;

    unbindActiveVideo();
    activeVideo = video;
    resetObservedVideoProgress(video);
    activeVideo.addEventListener("ended", handleEnded);
    activeVideo.addEventListener("timeupdate", handleTimeUpdate);
    activeVideo.addEventListener("seeking", handleSeeking);
    activeVideo.addEventListener("seeked", handleSeeked);
  }

  function scan() {
    if (!runtimeActive) return;
    if (isEnabled !== true || !isShortsPage()) {
      syncRuntime();
      return;
    }

    const shortId = getShortId();
    if (!shortId) {
      syncRuntime();
      return;
    }

    if (shortId !== activeShortId) {
      const isTransition = Boolean(activeShortId && activeShortId !== shortId);
      activeShortId = shortId;
      resetAdvanceState(shortId);
      resetObservedVideoProgress(activeVideo);
      progressArmed = !isTransition;
    }

    bindVideo(findActiveVideo());
    checkActiveVideoProgress();
  }

  function requestScan() {
    if (!runtimeActive || scanAnimationFrame) return;

    scanAnimationFrame = window.requestAnimationFrame(() => {
      scanAnimationFrame = 0;
      if (runtimeActive) scan();
    });
  }

  function startRuntime() {
    if (runtimeActive) {
      requestScan();
      return;
    }

    runtimeActive = true;
    observer = new MutationObserver(requestScan);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
    scanInterval = window.setInterval(requestScan, SCAN_INTERVAL_MS);
    progressInterval = window.setInterval(checkActiveVideoProgress, PROGRESS_CHECK_INTERVAL_MS);
    scan();
  }

  function stopRuntime() {
    runtimeActive = false;

    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (scanInterval) {
      window.clearInterval(scanInterval);
      scanInterval = 0;
    }
    if (progressInterval) {
      window.clearInterval(progressInterval);
      progressInterval = 0;
    }
    if (scanAnimationFrame) {
      window.cancelAnimationFrame(scanAnimationFrame);
      scanAnimationFrame = 0;
    }

    unbindActiveVideo();
    activeShortId = "";
    progressArmed = false;
    resetAdvanceState();
  }

  function syncRuntime() {
    if (isEnabled === true && isShortsPage()) {
      startRuntime();
      return;
    }

    stopRuntime();
  }

  function readEnabledSetting() {
    const storage = getStorageLocal();
    const revisionAtRead = settingRevision;

    if (!storage) {
      settingReadFailed = true;
      isEnabled = false;
      syncRuntime();
      return;
    }

    try {
      storage.get({ [STORAGE_KEY]: true }, (settings) => {
        if (destroyed) return;
        if (revisionAtRead !== settingRevision) return;

        const error = getRuntimeLastError();
        settingReadFailed = Boolean(error);
        isEnabled = error ? false : settings[STORAGE_KEY] !== false;
        syncRuntime();
      });
    } catch {
      if (revisionAtRead !== settingRevision) return;
      settingReadFailed = true;
      isEnabled = false;
      syncRuntime();
    }
  }

  function refresh() {
    if (destroyed) return;
    if (settingReadFailed) {
      readEnabledSetting();
      return;
    }
    syncRuntime();
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;

    try {
      stopRuntime();
    } catch {
      // Continue cleanup even if a stale page object cannot be released normally.
    }

    window.removeEventListener("yt-navigate-finish", refresh);
    window.removeEventListener("popstate", refresh);
    window.removeEventListener("pageshow", refresh);

    try {
      if (storageChanges) storageChanges.removeListener(handleStorageChange);
    } catch {
      // Extension updates can invalidate the old chrome.* context.
    } finally {
      if (window[CONTROLLER_KEY] === controller) delete window[CONTROLLER_KEY];
    }
  }

  controller.refresh = refresh;
  controller.destroy = destroy;

  window.addEventListener("yt-navigate-finish", refresh);
  window.addEventListener("popstate", refresh);
  window.addEventListener("pageshow", refresh);

  function handleStorageChange(changes, areaName) {
    if (destroyed || areaName !== "local" || !changes[STORAGE_KEY]) return;

    settingRevision += 1;
    settingReadFailed = false;
    isEnabled = changes[STORAGE_KEY].newValue !== false;
    syncRuntime();
  }

  const storageChanges = getStorageChanges();
  if (storageChanges) storageChanges.addListener(handleStorageChange);

  readEnabledSetting();
})();
