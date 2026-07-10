(function attachYtsAutoplayLogic(root, factory) {
  "use strict";

  const api = Object.freeze(factory());

  if (typeof module === "object" && module.exports) {
    module.exports = api;
    return;
  }

  root.YTSAutoplayLogic = api;
})(typeof globalThis === "object" ? globalThis : this, () => {
  "use strict";

  function isShortsPath(pathname) {
    return typeof pathname === "string" && /^\/shorts\/[^/?#]+/.test(pathname);
  }

  function getShortIdFromPath(pathname) {
    if (typeof pathname !== "string") return null;

    const match = pathname.match(/^\/shorts\/([^/?#]+)/);
    return match ? match[1] : null;
  }

  function isVideoNearEndSnapshot(snapshot, thresholdSeconds) {
    const duration = snapshot?.duration;
    const currentTime = snapshot?.currentTime;

    if (!Number.isFinite(duration) || duration < 0.5) return false;
    if (!Number.isFinite(currentTime) || currentTime < 0) return false;
    if (!Number.isFinite(thresholdSeconds) || thresholdSeconds < 0) return false;
    if (currentTime > duration + 0.25) return false;

    return duration - currentTime <= thresholdSeconds;
  }

  function didPlaybackLoop(snapshot, previousNearEndSeconds) {
    const currentTime = snapshot?.currentTime;
    const previousTime = snapshot?.previousTime;
    const duration = snapshot?.duration;
    const previousDuration = snapshot?.previousDuration;

    if (snapshot?.isSeeking) return false;
    if (![currentTime, previousTime, duration, previousDuration].every(Number.isFinite)) return false;
    if (duration < 0.5 || previousDuration < 0.5) return false;
    if (!Number.isFinite(previousNearEndSeconds) || previousNearEndSeconds <= 0) return false;
    if (Math.abs(duration - previousDuration) > 0.25) return false;
    if (currentTime < 0 || currentTime >= 2) return false;
    if (previousTime <= currentTime + 3) return false;
    if (previousTime > previousDuration + 0.25) return false;

    return previousDuration - previousTime <= previousNearEndSeconds;
  }

  function didShortChange(previousShortId, currentShortId) {
    return Boolean(previousShortId && currentShortId && previousShortId !== currentShortId);
  }

  return {
    isShortsPath,
    getShortIdFromPath,
    isVideoNearEndSnapshot,
    didPlaybackLoop,
    didShortChange
  };
});
