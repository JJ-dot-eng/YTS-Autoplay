(() => {
  "use strict";

  if (window.__YTS_AUTOPLAY_CONTENT_LOADED__) {
    return;
  }

  window.__YTS_AUTOPLAY_CONTENT_LOADED__ = true;

  const SCAN_INTERVAL_MS = 500;
  const PROGRESS_CHECK_INTERVAL_MS = 100;
  const END_THRESHOLD_SECONDS = 0.2;
  const NEXT_COOLDOWN_MS = 900;
  const ADVANCE_VERIFY_DELAY_MS = 600;
  const MAX_ADVANCE_ATTEMPTS_PER_SHORT = 3;
  const STORAGE_KEY = "enabled";

  let activeVideo = null;
  let activeShortId = "";
  let advancedShortId = "";
  let advanceAttemptShortId = "";
  let advanceAttemptCount = 0;
  let advanceVerifyTimer = 0;
  let lastAdvanceAt = 0;
  let observedVideo = null;
  let observedVideoTime = 0;
  let observedVideoDuration = 0;
  let isEnabled = true;

  function getStorageLocal() {
    if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) {
      return null;
    }

    return chrome.storage.local;
  }

  function getStorageChanges() {
    if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.onChanged) {
      return null;
    }

    return chrome.storage.onChanged;
  }

  function readEnabledSetting() {
    const storage = getStorageLocal();
    if (!storage) return;

    storage.get({ [STORAGE_KEY]: true }, (settings) => {
      isEnabled = settings[STORAGE_KEY] !== false;

      if (!isEnabled) {
        resetAdvanceState();
        unbindActiveVideo();
        return;
      }

      scan();
    });
  }

  function isShortsPage() {
    return location.pathname.startsWith("/shorts/");
  }

  function getShortId() {
    const match = location.pathname.match(/^\/shorts\/([^/?#]+)/);
    return match ? match[1] : "";
  }

  function isVisibleVideo(video) {
    if (!(video instanceof HTMLVideoElement)) return false;

    const rect = video.getBoundingClientRect();
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;

    if (rect.width <= 0 || rect.height <= 0) return false;
    if (rect.bottom <= 0 || rect.right <= 0) return false;
    if (rect.top >= viewportHeight || rect.left >= viewportWidth) return false;

    return true;
  }

  function getVisibleArea(video) {
    const rect = video.getBoundingClientRect();
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;

    const visibleWidth = Math.max(0, Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0));
    const visibleHeight = Math.max(0, Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0));

    return visibleWidth * visibleHeight;
  }

  function findActiveVideo() {
    return Array.from(document.querySelectorAll("video"))
      .filter(isVisibleVideo)
      .sort((first, second) => getVisibleArea(second) - getVisibleArea(first))[0] || null;
  }

  function resetAdvanceState() {
    advancedShortId = "";
    advanceAttemptShortId = "";
    advanceAttemptCount = 0;

    if (advanceVerifyTimer) {
      window.clearTimeout(advanceVerifyTimer);
      advanceVerifyTimer = 0;
    }
  }

  function getFiniteDuration(video) {
    return Number.isFinite(video.duration) ? video.duration : 0;
  }

  function resetObservedVideoProgress(video) {
    observedVideo = video || null;
    observedVideoTime = video ? video.currentTime || 0 : 0;
    observedVideoDuration = video ? getFiniteDuration(video) : 0;
  }

  function didActiveVideoLoop(video) {
    if (!video || video !== observedVideo) return false;

    const currentTime = video.currentTime || 0;
    const duration = getFiniteDuration(video);
    const durationChanged = duration && observedVideoDuration && Math.abs(duration - observedVideoDuration) > 0.25;

    if (durationChanged) return false;

    return currentTime < 2 && observedVideoTime > currentTime + 3;
  }

  function rememberVideoProgress(video) {
    observedVideo = video;
    observedVideoTime = video.currentTime || 0;
    observedVideoDuration = getFiniteDuration(video);
  }

  function isVisibleElement(element) {
    if (!(element instanceof HTMLElement)) return false;

    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;

    if (rect.width <= 0 || rect.height <= 0) return false;
    if (rect.bottom <= 0 || rect.right <= 0) return false;
    if (rect.top >= viewportHeight || rect.left >= viewportWidth) return false;
    if (style.visibility === "hidden" || style.display === "none" || style.pointerEvents === "none") return false;

    return true;
  }

  function isNextButtonLabel(label) {
    return /next/i.test(label) || label.includes("\uB2E4\uC74C");
  }

  function isPreviousButtonLabel(label) {
    return /previous|prev/i.test(label) || label.includes("\uC774\uC804");
  }

  function findNextButton() {
    const selectors = [
      "ytd-reel-video-renderer[is-active] button[aria-label]",
      "ytd-shorts button[aria-label]",
      "button[aria-label]"
    ];

    for (const selector of selectors) {
      const buttons = Array.from(document.querySelectorAll(selector));
      const nextButton = buttons.find((button) => {
        const label = button.getAttribute("aria-label") || "";
        return isNextButtonLabel(label) && !isPreviousButtonLabel(label) && !button.disabled && isVisibleElement(button);
      });

      if (nextButton) return nextButton;
    }

    return null;
  }

  function scrollToNextShort() {
    const distance = window.innerHeight || document.documentElement.clientHeight || 800;
    const activeRenderer = document.querySelector("ytd-reel-video-renderer[is-active]");
    const targets = [
      activeRenderer?.parentElement,
      document.querySelector("ytd-shorts"),
      document.scrollingElement,
      document.documentElement,
      document.body
    ];
    const seenTargets = new Set();

    for (const target of targets) {
      if (!target || seenTargets.has(target) || typeof target.scrollBy !== "function") continue;
      seenTargets.add(target);

      if (target.scrollHeight <= target.clientHeight) continue;

      target.scrollBy({
        top: distance,
        behavior: "auto"
      });
      return true;
    }

    window.scrollBy({
      top: distance,
      behavior: "auto"
    });
    return true;
  }

  function scheduleAdvanceVerification(shortId, videoAtAttempt) {
    if (!shortId) return;

    const durationAtAttempt = videoAtAttempt?.duration;

    if (advanceVerifyTimer) {
      window.clearTimeout(advanceVerifyTimer);
    }

    advanceVerifyTimer = window.setTimeout(() => {
      advanceVerifyTimer = 0;

      if (!isEnabled) return;
      if (!isShortsPage()) return;
      if (getShortId() !== shortId) return;

      const visibleVideo = findActiveVideo();
      if (videoAtAttempt && visibleVideo && visibleVideo !== videoAtAttempt) return;
      if (
        Number.isFinite(durationAtAttempt) &&
        visibleVideo === videoAtAttempt &&
        Number.isFinite(visibleVideo.duration) &&
        Math.abs(visibleVideo.duration - durationAtAttempt) > 0.25
      ) {
        return;
      }

      advancedShortId = "";
      lastAdvanceAt = 0;
      advanceToNextShort();
    }, ADVANCE_VERIFY_DELAY_MS);
  }

  function advanceToNextShort() {
    if (!isEnabled) return;
    if (!isShortsPage()) return;

    const now = Date.now();
    const shortId = getShortId();

    if (shortId && shortId !== advanceAttemptShortId) {
      advanceAttemptShortId = shortId;
      advanceAttemptCount = 0;
    }

    if (shortId && advanceAttemptCount >= MAX_ADVANCE_ATTEMPTS_PER_SHORT) return;
    if (shortId && advancedShortId === shortId) return;
    if (now - lastAdvanceAt < NEXT_COOLDOWN_MS) return;

    advancedShortId = shortId;
    if (shortId) advanceAttemptCount += 1;
    lastAdvanceAt = now;

    const nextButton = findNextButton();
    if (nextButton) {
      try {
        nextButton.click();
        scheduleAdvanceVerification(shortId, activeVideo);
      } catch {
        advancedShortId = "";
      }
      return;
    }

    if (scrollToNextShort()) {
      scheduleAdvanceVerification(shortId, activeVideo);
    }
  }

  function isVideoNearEnd(video) {
    if (!video.duration || !Number.isFinite(video.duration)) return false;
    if (video.duration < 0.5) return false;

    return video.duration - video.currentTime <= END_THRESHOLD_SECONDS;
  }

  function handleEnded(event) {
    if (event.currentTarget !== activeVideo) return;
    advanceToNextShort();
  }

  function shouldAdvanceVideo(video) {
    if (video.paused && !video.ended) {
      rememberVideoProgress(video);
      return false;
    }

    const shouldAdvance = video.ended || isVideoNearEnd(video) || didActiveVideoLoop(video);
    rememberVideoProgress(video);

    return shouldAdvance;
  }

  function handleTimeUpdate(event) {
    const video = event.currentTarget;
    if (video !== activeVideo) return;
    if (!shouldAdvanceVideo(video)) return;

    advanceToNextShort();
  }

  function checkActiveVideoProgress() {
    if (!activeVideo) return;
    if (!shouldAdvanceVideo(activeVideo)) return;

    advanceToNextShort();
  }

  function unbindActiveVideo() {
    if (!activeVideo) return;

    activeVideo.removeEventListener("ended", handleEnded);
    activeVideo.removeEventListener("timeupdate", handleTimeUpdate);
    activeVideo = null;
    resetObservedVideoProgress(null);
  }

  function bindVideo(video) {
    if (!video || video === activeVideo) return;

    unbindActiveVideo();
    activeVideo = video;
    activeShortId = getShortId();
    resetObservedVideoProgress(video);

    activeVideo.addEventListener("ended", handleEnded);
    activeVideo.addEventListener("timeupdate", handleTimeUpdate);
  }

  function scan() {
    if (!isEnabled) {
      unbindActiveVideo();
      return;
    }

    if (!isShortsPage()) {
      unbindActiveVideo();
      activeShortId = "";
      resetAdvanceState();
      return;
    }

    const shortId = getShortId();
    if (shortId && shortId !== activeShortId) {
      activeShortId = shortId;
      resetAdvanceState();
    }

    bindVideo(findActiveVideo());
    checkActiveVideoProgress();
  }

  const observer = new MutationObserver(scan);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  window.addEventListener("yt-navigate-finish", scan);
  window.addEventListener("popstate", scan);

  const storageChanges = getStorageChanges();
  if (storageChanges) {
    storageChanges.addListener((changes, areaName) => {
      if (areaName !== "local" || !changes[STORAGE_KEY]) return;

      isEnabled = changes[STORAGE_KEY].newValue !== false;

      if (isEnabled) {
        scan();
        return;
      }

      resetAdvanceState();
      unbindActiveVideo();
    });
  }

  readEnabledSetting();
  scan();
  setInterval(scan, SCAN_INTERVAL_MS);
  setInterval(checkActiveVideoProgress, PROGRESS_CHECK_INTERVAL_MS);
})();
