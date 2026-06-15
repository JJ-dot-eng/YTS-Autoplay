(() => {
  "use strict";

  const SCAN_INTERVAL_MS = 500;
  const END_THRESHOLD_SECONDS = 0.35;
  const NEXT_COOLDOWN_MS = 900;

  let activeVideo = null;
  let activeShortId = "";
  let advancedShortId = "";
  let lastAdvanceAt = 0;

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

  function findNextButton() {
    const selectors = [
      'button[aria-label="Next video"]',
      'button[aria-label="Next"]',
      'button[aria-label="다음 동영상"]',
      'button[aria-label="다음"]',
      "ytd-reel-video-renderer[is-active] button[aria-label]",
      "ytd-shorts button[aria-label]"
    ];

    for (const selector of selectors) {
      const buttons = Array.from(document.querySelectorAll(selector));
      const nextButton = buttons.find((button) => {
        const label = button.getAttribute("aria-label") || "";
        return /next|다음/i.test(label) && !button.disabled;
      });

      if (nextButton) return nextButton;
    }

    return null;
  }

  function scrollToNextShort() {
    window.scrollBy({
      top: window.innerHeight || document.documentElement.clientHeight || 800,
      behavior: "smooth"
    });
  }

  function advanceToNextShort() {
    if (!isShortsPage()) return;

    const now = Date.now();
    const shortId = getShortId();

    if (shortId && advancedShortId === shortId) return;
    if (now - lastAdvanceAt < NEXT_COOLDOWN_MS) return;

    advancedShortId = shortId;
    lastAdvanceAt = now;

    const nextButton = findNextButton();
    if (nextButton) {
      nextButton.click();
      return;
    }

    scrollToNextShort();
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

  function handleTimeUpdate(event) {
    const video = event.currentTarget;
    if (video !== activeVideo) return;
    if (!isVideoNearEnd(video)) return;

    advanceToNextShort();
  }

  function unbindActiveVideo() {
    if (!activeVideo) return;

    activeVideo.removeEventListener("ended", handleEnded);
    activeVideo.removeEventListener("timeupdate", handleTimeUpdate);
    activeVideo = null;
  }

  function bindVideo(video) {
    if (!video || video === activeVideo) return;

    unbindActiveVideo();
    activeVideo = video;
    activeShortId = getShortId();

    activeVideo.addEventListener("ended", handleEnded);
    activeVideo.addEventListener("timeupdate", handleTimeUpdate);
  }

  function scan() {
    if (!isShortsPage()) {
      unbindActiveVideo();
      activeShortId = "";
      return;
    }

    const shortId = getShortId();
    if (shortId && shortId !== activeShortId) {
      activeShortId = shortId;
      advancedShortId = "";
    }

    bindVideo(findActiveVideo());
  }

  const observer = new MutationObserver(scan);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  window.addEventListener("yt-navigate-finish", scan);
  window.addEventListener("popstate", scan);

  scan();
  setInterval(scan, SCAN_INTERVAL_MS);
})();
