const { randomBytes } = require("node:crypto");

const newLifecycleId = () => randomBytes(16).toString("hex");

function createBrowserSmokeLifecycle(stateStore) {
  const initial = stateStore.read();
  let lifecycleId = typeof initial.browserSmokeLifecycleId === "string"
    && initial.browserSmokeLifecycleId.length > 0
    ? initial.browserSmokeLifecycleId
    : newLifecycleId();

  if (initial.browserSmokePassed === true && !initial.browserSmokeLifecycleId) {
    stateStore.update({
      browserSmokePassed: false,
      browserSmokeVersion: null,
      browserSmokeLifecycleId: lifecycleId,
    });
  } else if (initial.browserSmokeLifecycleId !== lifecycleId) {
    stateStore.update({ browserSmokeLifecycleId: lifecycleId });
  }

  return {
    invalidateBrowserSmoke() {
      lifecycleId = newLifecycleId();
      return stateStore.update({
        browserSmokePassed: false,
        browserSmokeVersion: null,
        browserSmokeLifecycleId: lifecycleId,
      });
    },
    markSmokePassed(version) {
      return stateStore.update({
        browserSmokePassed: true,
        browserSmokeVersion: version,
        browserSmokeLifecycleId: lifecycleId,
      });
    },
    isSmokePassed(state, version) {
      return state.browserSmokePassed === true
        && state.browserSmokeVersion === version
        && state.browserSmokeLifecycleId === lifecycleId;
    },
  };
}

module.exports = { createBrowserSmokeLifecycle };
