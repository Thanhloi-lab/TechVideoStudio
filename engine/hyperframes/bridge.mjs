// Render-mode bridge injected (Page.addScriptToEvaluateOnNewDocument) into a HyperFrames
// composition by our zero-dep renderer. Mirrors what @hyperframes/producer injects
// (packages/producer/src/services/fileServer.ts → RENDER_MODE_SCRIPT + HF_BRIDGE_SCRIPT):
//   window.__hf.duration  (getter; 0 until window.__renderReady)
//   window.__hf.seek(t)   → window.__player.renderSeek(t)
// Frame capture then follows the engine protocol: __hf.seek(t) → await __hfWaitForSeekCompletion().

/**
 * Build the bridge for a given output fps. `window.__HF_EXPORT_RENDER_SEEK_CONFIG.fps` becomes the
 * runtime's canonical fps (renderSeek quantizes seek times to that grid; default would be 30) and
 * puts media into render mode (no native playback — audio is mixed by our encoder instead).
 */
export function buildRenderBridgeScript({ fps = 30 } = {}) {
  const safeFps = Number(fps) > 0 ? Number(fps) : 30;
  return `(function () {
  window.__HF_EXPORT_RENDER_SEEK_CONFIG = window.__HF_EXPORT_RENDER_SEEK_CONFIG || {
    mode: "preview-phase",
    diagnostics: false,
    step: 1 / 120,
    offsetFraction: 0.5,
    fps: ${safeFps},
    fpsSource: "render-options",
    owner: "runtime",
  };
})();
${HF_RENDER_BRIDGE_SCRIPT}`;
}

export const HF_RENDER_BRIDGE_SCRIPT = `(function () {
  if (window.__tvsHfBridgeInstalled) return;
  window.__tvsHfBridgeInstalled = true;
  window.__HF_RENDER_MODE__ = true;
  function declaredDuration() {
    var root = document.querySelector("[data-composition-id]");
    var d = root ? Number(root.getAttribute("data-duration")) : 0;
    return isFinite(d) && d > 0 ? d : 0;
  }
  function bridge() {
    var p = window.__player;
    if (!p || typeof p.renderSeek !== "function" || typeof p.getDuration !== "function") return false;
    var hf = window.__hf || {};
    Object.defineProperty(hf, "duration", {
      configurable: true,
      enumerable: true,
      get: function () {
        if (window.__hfTimelinesBuilding) return 0;
        if (!window.__renderReady) return 0;
        var d = Number(p.getDuration());
        return d > 0 ? d : declaredDuration();
      },
    });
    hf.seek = function (t, options) {
      p.renderSeek(Math.max(0, Number(t) || 0), options);
    };
    window.__hf = hf;
    window.__playerReady = true;
    return true;
  }
  if (bridge()) return;
  var iv = setInterval(function () {
    if (bridge()) clearInterval(iv);
  }, 25);
})();`;

/**
 * Expression: { ok, duration, buildErrors[], startupError? }. `ok` turns true once the runtime
 * exposes window.__hf with a positive duration AND our bootstrap finished building scenes.
 * buildErrors lists scene modules that failed (their scenes show an error placeholder).
 */
export const HF_READY_EXPRESSION = `(() => {
  const buildErrors = Array.isArray(window.__tvsBuildErrors) ? window.__tvsBuildErrors.slice() : [];
  if (typeof window.__hfStartupError === "string") return { ok: false, startupError: window.__hfStartupError, buildErrors };
  const ok = !!(window.__hf && typeof window.__hf.seek === "function" && window.__hf.duration > 0 && window.__tvsReady);
  return { ok, duration: ok ? window.__hf.duration : 0, buildErrors, tvsReady: !!window.__tvsReady };
})()`;

/** Poll HF_READY_EXPRESSION until ok (or a fatal startup error / timeout). */
export async function waitForComposition(evaluateFn, { timeoutMs = 45_000, sleepFn } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await evaluateFn(HF_READY_EXPRESSION).catch(() => null);
    if (last?.startupError) throw new Error(`HyperFrames runtime startup error: ${last.startupError}`);
    if (last?.ok) return last;
    if (last?.tvsReady && last.buildErrors?.length && !last.ok) {
      // bootstrap finished but no timeline registered → fatal
      if (Date.now() + 2000 > deadline) break;
    }
    await sleepFn(100);
  }
  const why = last?.buildErrors?.length ? `\n${last.buildErrors.join("\n")}` : "";
  throw new Error(`Timed out waiting for the HyperFrames runtime (window.__hf) to become ready${why}`);
}

/** Expression builder: seek to t and wait for every seek hold (fonts, images, media) to settle. */
export function seekExpression(t) {
  return `(async () => {
    window.__hf.seek(${Number(t)});
    if (typeof window.__hfWaitForSeekCompletion === "function") await window.__hfWaitForSeekCompletion();
    return true;
  })()`;
}
