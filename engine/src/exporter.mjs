import {
  MOTION_TOKENS,
  clamp01,
  computeSceneEnvelope,
  createBokehSeeds,
  createSparkleParticles,
  getSceneBurstInfo,
  renderAmbientLayer,
  renderSparkleBurst,
  stepSparkleParticles,
} from "./motion/kernel.mjs";
import {
  drawSubtitles,
  drawTopBar,
  drawTopProgressBar,
  drawViewfinderBrackets,
  paletteV2,
  roundRect,
  wrapSubtitleSegments,
  wrapText,
} from "./canvas_templates/shared.mjs";
import { drawArchitectureScene, getCachedArchitectureLayout } from "./canvas_templates/architecture.mjs";
import { drawConsoleScene } from "./canvas_templates/console_setup.mjs";
import { drawCodeCliScene, registerShikiTokens, tokenizeCodeLine, tokenizeCodeLines } from "./canvas_templates/code_cli.mjs";
import { drawExamScene } from "./canvas_templates/exam_tips.mjs";
import {
  drawComparisonMatrixScene,
  drawKpiMetricsScene,
  drawTimelineFlowScene,
} from "./canvas_templates/data_templates.mjs";

export {
  drawArchitectureScene,
  drawCodeCliScene,
  drawComparisonMatrixScene,
  drawConsoleScene,
  drawExamScene,
  drawKpiMetricsScene,
  drawSubtitles,
  drawTimelineFlowScene,
  drawTopBar,
  drawTopProgressBar,
  drawViewfinderBrackets,
  getCachedArchitectureLayout,
  registerShikiTokens,
  roundRect,
  tokenizeCodeLine,
  tokenizeCodeLines,
  wrapSubtitleSegments,
  wrapText,
};

function drawSceneFrame(
  ctx,
  W,
  H,
  script,
  scene,
  sceneIdx,
  sceneTime,
  sceneDur,
  globalTimeSec,
  globalProgress,
  fxState,
  speed = 1
) {
  const logicalW = LOGICAL_WIDTH;
  const logicalH = LOGICAL_HEIGHT;
  const dur = Math.max(0.1, sceneDur || scene.duration_sec || 1);
  const progress = clamp01(sceneTime / dur);
  const envelope = computeSceneEnvelope(sceneTime, dur);

  // Fill physical canvas bounds first to avoid 1px rounding seams on fractional scales (720p/1440p)
  ctx.save();
  ctx.fillStyle = paletteV2.bgBottom;
  ctx.fillRect(0, 0, W, H);
  ctx.scale(W / logicalW, H / logicalH);

  try {
    // Layer 0: V2 Navy-Cyan gradient + 60px blueprint grid + deterministic slow bokeh
    renderAmbientLayer(ctx, logicalW, logicalH, globalTimeSec, fxState.bokehSeeds, {
      drawBackground: true,
    });

    // Layer 1: Scene Header + Visual Content wrapped with Blur-to-Sharp Entrance, Exit Z-Recede, Dark Breather
    if (!envelope.inBreather && envelope.opacity > 0.005) {
      ctx.save();
      if (envelope.opacity < 0.999) {
        ctx.globalAlpha = envelope.opacity;
      }
      if (envelope.blurPx >= 0.8) {
        ctx.filter = `blur(${envelope.blurPx.toFixed(1)}px)`;
      }
      if (Math.abs(envelope.scale - 1) > 0.0005) {
        ctx.translate(logicalW / 2, logicalH / 2);
        ctx.scale(envelope.scale, envelope.scale);
        ctx.translate(-logicalW / 2, -logicalH / 2);
      }

      drawTopBar(ctx, logicalW, script, scene);

      if (scene.visual_type === "console_setup") {
        drawConsoleScene(ctx, logicalW, logicalH, scene, progress, sceneTime, dur);
      } else if (scene.visual_type === "code_cli") {
        drawCodeCliScene(ctx, logicalW, logicalH, scene, progress, sceneTime);
      } else if (scene.visual_type === "exam_tips") {
        drawExamScene(ctx, logicalW, logicalH, scene, progress, sceneTime, dur);
      } else if (scene.visual_type === "comparison_matrix") {
        drawComparisonMatrixScene(ctx, logicalW, logicalH, scene, progress);
      } else if (scene.visual_type === "timeline_flow") {
        drawTimelineFlowScene(ctx, logicalW, logicalH, scene, progress);
      } else if (scene.visual_type === "kpi_metrics") {
        drawKpiMetricsScene(ctx, logicalW, logicalH, scene, progress);
      } else {
        drawArchitectureScene(ctx, logicalW, logicalH, scene, progress, sceneTime, dur, fxState.camera);
      }
      ctx.restore();
    }

    // Layer 2: Multi-color Sparkle Confetti Bursts on scene / major step transitions
    const dt = Math.max(0.001, Math.min(0.05, globalTimeSec - fxState.lastGlobalTime));
    fxState.lastGlobalTime = globalTimeSec;

    const burst = getSceneBurstInfo(scene, progress, logicalW, logicalH, sceneIdx);
    if (burst.key !== fxState.lastBurstKey && !envelope.inBreather) {
      fxState.lastBurstKey = burst.key;
      fxState.sparkles = fxState.sparkles.concat(createSparkleParticles(burst.cx, burst.cy, 24));
    }
    if (fxState.sparkles.length > 0) {
      fxState.sparkles = stepSparkleParticles(fxState.sparkles, dt);
      if (fxState.sparkles.length > 0) {
        renderSparkleBurst(ctx, fxState.sparkles);
      }
    }

    // Layer 3: Top 6px V2 Gradient Progress Bar & Box-Free Keyword-Highlighted Subtitles
    // Subtitles in script.json are authored in 1x audio seconds, so scale sceneTime by playback speed.
    drawTopProgressBar(ctx, logicalW, globalProgress);
    drawSubtitles(ctx, logicalW, logicalH, script, scene, sceneTime * speed);
  } finally {
    ctx.restore();
  }
}

const LOGICAL_WIDTH = 1920;
const LOGICAL_HEIGHT = 1080;
export const EXPORT_AUDIO_SAMPLE_RATE = 48_000;
export const EXPORT_AUDIO_CHANNELS = 2;
const EXPORT_AUDIO_BITRATE = 128_000;

export const RESOLUTION_PRESETS = Object.freeze({
  "720p": Object.freeze({ id: "720p", width: 1280, height: 720, label: "HD 720p" }),
  "1080p": Object.freeze({ id: "1080p", width: 1920, height: 1080, label: "FHD 1080p" }),
  "1440p": Object.freeze({ id: "1440p", width: 2560, height: 1440, label: "2K 1440p" }),
  "2160p": Object.freeze({ id: "2160p", width: 3840, height: 2160, label: "4K 2160p" }),
});

export const FPS_PRESETS = Object.freeze([24, 30, 60]);
export const SPEED_PRESETS = Object.freeze([1, 1.25, 1.5, 2]);
export const HARDWARE_MODES = Object.freeze(["auto", "gpu", "cpu"]);

export const FORMAT_CODEC_PRESETS = Object.freeze({
  "mp4:h264": Object.freeze({ format: "mp4", codec: "h264", ext: "mp4", mimeType: "video/mp4" }),
  "mp4:hevc": Object.freeze({ format: "mp4", codec: "hevc", ext: "mp4", mimeType: "video/mp4" }),
  "webm:vp9": Object.freeze({ format: "webm", codec: "vp9", ext: "webm", mimeType: "video/webm" }),
});

const BASE_60FPS_BITRATES = Object.freeze({
  "720p": 6_000_000,
  "1080p": 12_000_000,
  "1440p": 20_000_000,
  "2160p": 36_000_000,
});

export function computeTargetVideoBitrate({ resolution = "1080p", fps = 60, codec = "h264" } = {}) {
  const resKey = RESOLUTION_PRESETS[resolution] ? resolution : "1080p";
  const base60 = BASE_60FPS_BITRATES[resKey] || 12_000_000;
  const numFps = Number(fps) || 60;
  const fpsMul = numFps <= 24 ? 0.55 : numFps <= 30 ? 0.65 : 1.0;
  const normCodec = String(codec || "h264").toLowerCase();
  const codecMul = normCodec === "hevc" || normCodec === "vp9" ? 0.75 : 1.0;
  return Math.round(base60 * fpsMul * codecMul);
}

export function normalizeExportOptions({
  format,
  codec,
  hardware = "auto",
  resolution = "1080p",
  fps = 60,
  speed = 1,
} = {}) {
  let normFormat = format ? String(format).trim().toLowerCase() : "";
  let normCodec = codec ? String(codec).trim().toLowerCase() : "";

  if (normCodec === "avc" || normCodec === "h.264") normCodec = "h264";
  if (normCodec === "h265" || normCodec === "h.265") normCodec = "hevc";

  if (!normFormat && !normCodec) {
    normFormat = "mp4";
    normCodec = "h264";
  } else if (normFormat === "mp4" && !normCodec) {
    normCodec = "h264";
  } else if (normFormat === "webm" && !normCodec) {
    normCodec = "vp9";
  } else if (!normFormat && normCodec) {
    normFormat = normCodec === "vp9" ? "webm" : "mp4";
  }

  const pairKey = `${normFormat}:${normCodec}`;
  if (!FORMAT_CODEC_PRESETS[pairKey]) {
    throw new Error(
      `Định dạng/codec không hợp lệ: format="${normFormat}", codec="${normCodec}". Hỗ trợ: mp4 (h264, hevc) hoặc webm (vp9).`
    );
  }

  const normHardware = String(hardware || "auto").trim().toLowerCase();
  if (!HARDWARE_MODES.includes(normHardware)) {
    throw new Error(`Chế độ hardware không hợp lệ: "${hardware}". Hỗ trợ: auto, gpu, cpu.`);
  }

  const normResolution = String(resolution || "1080p").trim().toLowerCase();
  const resPreset = RESOLUTION_PRESETS[normResolution];
  if (!resPreset) {
    throw new Error(`Độ phân giải không hợp lệ: "${resolution}". Hỗ trợ: 720p, 1080p, 1440p, 2160p.`);
  }

  const normFps = Number(fps ?? 60);
  if (!FPS_PRESETS.includes(normFps)) {
    throw new Error(`FPS không hợp lệ: "${fps}". Hỗ trợ: 24, 30, 60.`);
  }

  const rawSpeed = Number(speed ?? 1);
  const matchedSpeed = SPEED_PRESETS.find((s) => Math.abs(s - rawSpeed) < 1e-6);
  if (!matchedSpeed) {
    throw new Error(`Tốc độ không hợp lệ: "${speed}". Hỗ trợ: 1, 1.25, 1.5, 2.`);
  }

  return {
    format: normFormat,
    codec: normCodec,
    ext: FORMAT_CODEC_PRESETS[pairKey].ext,
    mimeType: FORMAT_CODEC_PRESETS[pairKey].mimeType,
    hardware: normHardware,
    resolution: normResolution,
    width: resPreset.width,
    height: resPreset.height,
    fps: normFps,
    speed: matchedSpeed,
    bitrate: computeTargetVideoBitrate({ resolution: normResolution, fps: normFps, codec: normCodec }),
  };
}

const WSOLA_WINDOW_MS = 40;
const WSOLA_SEARCH_MS = 15;

/**
 * Compute WSOLA read positions using 50% overlap Hann window and coarse-to-fine
 * normalized cross-correlation (NCC) search.
 */
function computeWsolaPlan(refChannel, rate, sampleRate = EXPORT_AUDIO_SAMPLE_RATE) {
  const inputLen = refChannel?.length || 0;
  const safeRate = Number(rate);
  if (!Number.isFinite(safeRate) || safeRate <= 0) {
    throw new Error(`Tốc độ time-stretch không hợp lệ: ${rate}`);
  }
  if (inputLen <= 0) {
    return { winLen: 0, hopOut: 0, outLen: 0, window: new Float32Array(0), offsets: null };
  }

  const outLen = Math.max(1, Math.round(inputLen / safeRate));
  const halfWin = Math.max(64, Math.round((WSOLA_WINDOW_MS / 2000) * sampleRate));
  const winLen = halfWin * 2;
  const hopOut = halfWin;
  const searchRadius = Math.max(16, Math.round((WSOLA_SEARCH_MS / 1000) * sampleRate));

  const window = new Float32Array(winLen);
  for (let n = 0; n < winLen; n++) {
    window[n] = 0.5 * (1 - Math.cos((2 * Math.PI * n) / winLen));
  }

  if (inputLen <= winLen || Math.abs(safeRate - 1) < 1e-4) {
    return { winLen, hopOut, outLen, window, offsets: null };
  }

  const maxStart = inputLen - winLen;
  const numFrames = Math.ceil(outLen / hopOut);
  const offsets = new Int32Array(numFrames);
  offsets[0] = 0;

  const ovLen = hopOut;
  const coarseStep = 4;
  const innerCoarseStep = 2;

  for (let m = 1; m < numFrames; m++) {
    const outPos = m * hopOut;
    const nomPos = Math.min(maxStart, Math.max(0, Math.round(outPos * safeRate)));
    const natPos = Math.min(maxStart, offsets[m - 1] + hopOut);

    let tmplEnergy = 0;
    for (let j = 0; j < ovLen; j++) {
      const s = refChannel[natPos + j];
      tmplEnergy += s * s;
    }

    if (tmplEnergy < 1e-9) {
      offsets[m] = nomPos;
      continue;
    }

    const searchMin = Math.max(0, nomPos - searchRadius);
    const searchMax = Math.min(maxStart, nomPos + searchRadius);

    let bestPos = nomPos;
    let bestScore = -Infinity;
    for (let cand = searchMin; cand <= searchMax; cand += coarseStep) {
      let dot = 0;
      let candEnergy = 0;
      for (let j = 0; j < ovLen; j += innerCoarseStep) {
        const a = refChannel[natPos + j];
        const b = refChannel[cand + j];
        dot += a * b;
        candEnergy += b * b;
      }
      const score = candEnergy > 1e-11 ? dot / Math.sqrt(candEnergy) : -Infinity;
      if (score > bestScore) {
        bestScore = score;
        bestPos = cand;
      }
    }

    const fineMin = Math.max(searchMin, bestPos - coarseStep);
    const fineMax = Math.min(searchMax, bestPos + coarseStep);
    let fineBestPos = bestPos;
    let fineBestScore = -Infinity;
    for (let cand = fineMin; cand <= fineMax; cand++) {
      let dot = 0;
      let candEnergy = 0;
      for (let j = 0; j < ovLen; j++) {
        const a = refChannel[natPos + j];
        const b = refChannel[cand + j];
        dot += a * b;
        candEnergy += b * b;
      }
      const score = candEnergy > 1e-11 ? dot / Math.sqrt(candEnergy) : -Infinity;
      if (score > fineBestScore) {
        fineBestScore = score;
        fineBestPos = cand;
      }
    }

    offsets[m] = fineBestScore === -Infinity ? nomPos : fineBestPos;
  }

  return { winLen, hopOut, outLen, window, offsets };
}

function synthesizeWsolaChannel(inputFloat32, plan, rate) {
  const inputLen = inputFloat32?.length || 0;
  if (inputLen === 0) return new Float32Array(0);

  const { winLen, hopOut, outLen, window, offsets } = plan;
  if (!offsets) {
    if (Math.abs(rate - 1) < 1e-4) {
      return new Float32Array(inputFloat32);
    }
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const srcIdx = Math.min(inputLen - 1, i * rate);
      const i0 = Math.floor(srcIdx);
      const i1 = Math.min(inputLen - 1, i0 + 1);
      const frac = srcIdx - i0;
      out[i] = inputFloat32[i0] * (1 - frac) + inputFloat32[i1] * frac;
    }
    return out;
  }

  const out = new Float32Array(outLen);
  const norm = new Float32Array(outLen);

  // Keep frame 0 initial attack at unity gain; taper only its right half for overlap
  const firstLimit = Math.min(winLen, outLen);
  for (let j = 0; j < firstLimit; j++) {
    const w = j < hopOut ? 1.0 : window[j];
    out[j] += inputFloat32[j] * w;
    norm[j] += w;
  }

  for (let m = 1; m < offsets.length; m++) {
    const outPos = m * hopOut;
    const inPos = offsets[m];
    const limit = Math.min(winLen, outLen - outPos, inputLen - inPos);
    for (let j = 0; j < limit; j++) {
      const w = window[j];
      out[outPos + j] += inputFloat32[inPos + j] * w;
      norm[outPos + j] += w;
    }
  }

  for (let i = 0; i < outLen; i++) {
    if (norm[i] > 1e-6) {
      const s = out[i] / norm[i];
      out[i] = s > 1 ? 1 : s < -1 ? -1 : s;
    }
  }

  return out;
}

/**
 * Pure-JS WSOLA pitch-preserving time-stretch for a single Float32Array channel.
 */
export function timeStretchChannel(inputFloat32, rate, sampleRate = EXPORT_AUDIO_SAMPLE_RATE) {
  const src = inputFloat32 instanceof Float32Array ? inputFloat32 : new Float32Array(inputFloat32 || 0);
  const safeRate = Number(rate ?? 1);
  if (Math.abs(safeRate - 1) < 1e-4) {
    return new Float32Array(src);
  }
  const plan = computeWsolaPlan(src, safeRate, sampleRate);
  return synthesizeWsolaChannel(src, plan, safeRate);
}

/**
 * Pure-JS WSOLA pitch-preserving time-stretch for an AudioBuffer (mono/stereo/multi-channel).
 * Computes shared hop alignment from a mono mix so stereo phase stays locked.
 */
export function timeStretchAudioBuffer(audioBuffer, rate, opts = {}) {
  const safeRate = Number(rate ?? 1);
  if (!audioBuffer || Math.abs(safeRate - 1) < 1e-4) {
    return audioBuffer;
  }

  const numChannels = Math.max(1, audioBuffer.numberOfChannels || 1);
  const len = audioBuffer.length || 0;
  const sr =
    (typeof opts === "number" ? opts : opts?.sampleRate) ||
    audioBuffer.sampleRate ||
    EXPORT_AUDIO_SAMPLE_RATE;

  let refChannel;
  if (numChannels === 1) {
    refChannel = audioBuffer.getChannelData(0);
  } else {
    refChannel = new Float32Array(len);
    const inv = 1 / numChannels;
    for (let c = 0; c < numChannels; c++) {
      const chData = audioBuffer.getChannelData(c);
      for (let i = 0; i < len; i++) {
        refChannel[i] += chData[i] * inv;
      }
    }
  }

  const plan = computeWsolaPlan(refChannel, safeRate, sr);
  const stretchedChannels = [];
  for (let c = 0; c < numChannels; c++) {
    stretchedChannels.push(synthesizeWsolaChannel(audioBuffer.getChannelData(c), plan, safeRate));
  }
  const outLen = stretchedChannels[0]?.length || 1;

  const ctx = typeof opts === "object" ? opts?.audioContext : null;
  if (ctx && typeof ctx.createBuffer === "function") {
    const outBuf = ctx.createBuffer(numChannels, outLen, sr);
    for (let c = 0; c < numChannels; c++) {
      outBuf.copyToChannel
        ? outBuf.copyToChannel(stretchedChannels[c], c)
        : outBuf.getChannelData(c).set(stretchedChannels[c]);
    }
    return outBuf;
  }

  if (typeof OfflineAudioContext === "function") {
    const tmpCtx = new OfflineAudioContext(numChannels, outLen, sr);
    const outBuf = tmpCtx.createBuffer(numChannels, outLen, sr);
    for (let c = 0; c < numChannels; c++) {
      outBuf.getChannelData(c).set(stretchedChannels[c]);
    }
    return outBuf;
  }

  return {
    numberOfChannels: numChannels,
    length: outLen,
    sampleRate: sr,
    duration: outLen / sr,
    getChannelData: (c) => stretchedChannels[c],
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createInitialFxState(W, H) {
  return {
    bokehSeeds: createBokehSeeds(22),
    sparkles: [],
    lastBurstKey: null,
    lastGlobalTime: 0,
    camera: {
      stepKey: null,
      fromX: W / 2,
      fromY: H / 2,
      fromZoom: 1,
      currX: W / 2,
      currY: H / 2,
      currZoom: 1,
      startTime: 0,
    },
  };
}

export async function loadMuxerModule(format) {
  if (format === "mp4") {
    try {
      return await import("mp4-muxer");
    } catch {
      try {
        return await import("/vendor/esm/mp4-muxer@5.1.4/index.mjs");
      } catch {
        return import("/vendor/esm/mp4-muxer.mjs");
      }
    }
  }
  try {
    return await import("webm-muxer");
  } catch {
    try {
      return await import("/vendor/esm/webm-muxer@5.1.4/index.mjs");
    } catch {
      return import("/vendor/esm/webm-muxer.mjs");
    }
  }
}

function getVideoCodecCandidates(codec, width, height, fps) {
  if (codec === "hevc") {
    if (width >= 3840 && fps > 30) {
      return ["hvc1.1.6.L153.90", "hvc1.1.6.L150.90", "hvc1.1.6.L123.90", "hvc1.1.6.L120.90"];
    }
    if (width >= 2560 || height >= 1440) {
      return ["hvc1.1.6.L150.90", "hvc1.1.6.L153.90", "hvc1.1.6.L123.90", "hvc1.1.6.L120.90"];
    }
    return ["hvc1.1.6.L123.90", "hvc1.1.6.L120.90", "hvc1.1.6.L150.90", "hvc1.1.6.L153.90"];
  }

  if (codec === "vp9") {
    if (width >= 3840) {
      return ["vp09.00.51.08", "vp09.00.50.08", "vp09.00.41.08", "vp09.00.10.08"];
    }
    if (width >= 2560 || height >= 1440) {
      return ["vp09.00.50.08", "vp09.00.51.08", "vp09.00.41.08", "vp09.00.10.08"];
    }
    return ["vp09.00.41.08", "vp09.00.50.08", "vp09.00.51.08", "vp09.00.10.08"];
  }

  // h264
  if (width >= 3840 && fps > 30) {
    return ["avc1.640034", "avc1.640033", "avc1.4d0033", "avc1.64002a", "avc1.4d002a"];
  }
  if (width >= 2560 || height >= 1440) {
    return ["avc1.640033", "avc1.4d0033", "avc1.640034", "avc1.64002a", "avc1.4d002a"];
  }
  return ["avc1.64002a", "avc1.4d002a", "avc1.640033", "avc1.4d0033", "avc1.640034"];
}

function getHardwarePreferenceOrder(codec, hardware) {
  if (hardware === "gpu") return ["prefer-hardware"];
  if (hardware === "cpu") return ["prefer-software"];
  // auto: probe showed VP9 prefer-hardware returns supported:false on AMD RX 9070 XT, so use no-preference for VP9
  if (codec === "vp9") return ["no-preference"];
  return ["prefer-hardware", "no-preference"];
}

export async function resolveWebCodecsProfile(options = "mp4") {
  const rawOpts = typeof options === "string" ? { format: options } : options || {};
  const opts = normalizeExportOptions(rawOpts);

  if (
    typeof VideoEncoder !== "function" ||
    typeof AudioEncoder !== "function" ||
    typeof VideoFrame !== "function" ||
    typeof AudioData !== "function" ||
    typeof VideoEncoder.isConfigSupported !== "function" ||
    typeof AudioEncoder.isConfigSupported !== "function"
  ) {
    return null;
  }

  const codecCandidates = getVideoCodecCandidates(opts.codec, opts.width, opts.height, opts.fps);
  const hwOrder = getHardwarePreferenceOrder(opts.codec, opts.hardware);

  let videoConfig = null;
  let resolvedHardwareAcceleration = hwOrder[0];

  for (const hwPref of hwOrder) {
    for (const codecString of codecCandidates) {
      const cfg = {
        codec: codecString,
        width: opts.width,
        height: opts.height,
        bitrate: opts.bitrate,
        framerate: opts.fps,
        hardwareAcceleration: hwPref,
      };
      try {
        const res = await VideoEncoder.isConfigSupported(cfg);
        if (res?.supported) {
          videoConfig = cfg;
          resolvedHardwareAcceleration = hwPref;
          break;
        }
      } catch {
        // Try next candidate
      }
    }
    if (videoConfig) break;
  }

  if (!videoConfig) {
    if (opts.hardware === "gpu") {
      if (opts.codec === "vp9") {
        throw new Error(
          "GPU hardware encode trong Chrome chỉ hỗ trợ H.264 / HEVC MP4 (VP9 không hỗ trợ prefer-hardware). Hãy chuyển sang MP4 (H.264/HEVC) hoặc chọn CPU / Auto."
        );
      }
      throw new Error(
        `GPU hardware encode (${opts.codec.toUpperCase()}) ở ${opts.resolution} ${opts.fps}fps không được hỗ trợ trên thiết bị/trình duyệt này. Hãy thử chế độ Auto hoặc CPU (H.264).`
      );
    }
    if (opts.hardware === "cpu") {
      if (opts.codec === "hevc") {
        throw new Error(
          "HEVC (H.265) trong Chrome yêu cầu GPU hardware encode (prefer-software không được hỗ trợ). Hãy dùng H.264 (MP4) hoặc VP9 (WebM) cho CPU, hoặc chuyển sang GPU / Auto."
        );
      }
      throw new Error(
        `CPU software encode (${opts.codec.toUpperCase()}) ở ${opts.resolution} ${opts.fps}fps không được trình duyệt hỗ trợ (prefer-software: false).`
      );
    }
    throw new Error(
      `Trình duyệt không hỗ trợ WebCodecs ${opts.codec.toUpperCase()} (${opts.format.toUpperCase()}) ở ${opts.resolution} ${opts.fps}fps.`
    );
  }

  let audioConfig = null;
  let muxerAudioCodec = opts.format === "mp4" ? "aac" : "A_OPUS";

  if (opts.format === "mp4") {
    const aacCfg = {
      codec: "mp4a.40.2",
      numberOfChannels: EXPORT_AUDIO_CHANNELS,
      sampleRate: EXPORT_AUDIO_SAMPLE_RATE,
      bitrate: EXPORT_AUDIO_BITRATE,
    };
    try {
      const aRes = await AudioEncoder.isConfigSupported(aacCfg);
      if (aRes?.supported) {
        audioConfig = aacCfg;
        muxerAudioCodec = "aac";
      }
    } catch {
      // Fallback below
    }
    if (!audioConfig) {
      const opusCfg = {
        codec: "opus",
        numberOfChannels: EXPORT_AUDIO_CHANNELS,
        sampleRate: EXPORT_AUDIO_SAMPLE_RATE,
        bitrate: EXPORT_AUDIO_BITRATE,
      };
      try {
        const oRes = await AudioEncoder.isConfigSupported(opusCfg);
        if (oRes?.supported) {
          audioConfig = opusCfg;
          muxerAudioCodec = "opus";
        }
      } catch {
        // Ignore
      }
    }
  } else {
    const opusCfg = {
      codec: "opus",
      numberOfChannels: EXPORT_AUDIO_CHANNELS,
      sampleRate: EXPORT_AUDIO_SAMPLE_RATE,
      bitrate: EXPORT_AUDIO_BITRATE,
    };
    try {
      const aRes = await AudioEncoder.isConfigSupported(opusCfg);
      if (aRes?.supported) {
        audioConfig = opusCfg;
        muxerAudioCodec = "A_OPUS";
      }
    } catch {
      // Ignore
    }
  }

  if (!audioConfig) {
    throw new Error(`Trình duyệt không hỗ trợ AudioEncoder cho định dạng ${opts.format.toUpperCase()}.`);
  }

  const muxerVideoCodec =
    opts.format === "mp4"
      ? opts.codec === "hevc"
        ? "hevc"
        : "avc"
      : "V_VP9";

  return {
    ...opts,
    hardwareAcceleration: resolvedHardwareAcceleration,
    videoConfig,
    audioConfig,
    muxerVideoCodec,
    muxerAudioCodec,
  };
}

async function decodeSceneAudioBuffers(episode, scenes, onProgress, speed = 1) {
  const decodeCtx = new OfflineAudioContext(EXPORT_AUDIO_CHANNELS, 1, EXPORT_AUDIO_SAMPLE_RATE);
  const buffers = [];
  const needStretch = Math.abs(speed - 1) >= 1e-4;

  for (let i = 0; i < scenes.length; i++) {
    const sc = scenes[i];
    onProgress?.({
      phase: "loading",
      label: needStretch
        ? `Đang tải & xử lý âm thanh ${speed}x cảnh ${i + 1}/${scenes.length}...`
        : `Đang tải âm thanh cảnh ${i + 1}/${scenes.length}...`,
      percent: 5 + Math.round((i / scenes.length) * 15),
    });

    if (!sc.audio_file) {
      const origDur = Number(sc.duration_sec) || 5;
      const silentFrames = Math.max(1, Math.round((origDur / speed) * EXPORT_AUDIO_SAMPLE_RATE));
      buffers.push(decodeCtx.createBuffer(EXPORT_AUDIO_CHANNELS, silentFrames, EXPORT_AUDIO_SAMPLE_RATE));
      continue;
    }

    const resp = await fetch(`${episode.base_url}/${sc.audio_file}`);
    if (!resp.ok) {
      throw new Error(`Không thể tải audio ${sc.audio_file} (HTTP ${resp.status})`);
    }
    const arr = await resp.arrayBuffer();
    const decoded = await decodeCtx.decodeAudioData(arr);

    let normalizedBuf;
    if (
      decoded.sampleRate === EXPORT_AUDIO_SAMPLE_RATE &&
      decoded.numberOfChannels === EXPORT_AUDIO_CHANNELS
    ) {
      normalizedBuf = decoded;
    } else {
      const targetFrames = Math.max(1, Math.round(decoded.duration * EXPORT_AUDIO_SAMPLE_RATE));
      const resampleCtx = new OfflineAudioContext(
        EXPORT_AUDIO_CHANNELS,
        targetFrames,
        EXPORT_AUDIO_SAMPLE_RATE
      );
      const src = resampleCtx.createBufferSource();
      src.buffer = decoded;
      src.connect(resampleCtx.destination);
      src.start(0);
      normalizedBuf = await resampleCtx.startRendering();
    }

    if (needStretch) {
      normalizedBuf = timeStretchAudioBuffer(normalizedBuf, speed, {
        audioContext: decodeCtx,
        sampleRate: EXPORT_AUDIO_SAMPLE_RATE,
      });
    }
    buffers.push(normalizedBuf);
  }

  return buffers;
}

export function resolveOutputFilename(rawName, episodeId, actualExt = "webm") {
  const safeExt = String(actualExt || "").toLowerCase() === "mp4" ? "mp4" : "webm";
  const fallbackStem =
    String(episodeId || "video")
      .trim()
      .replace(/[\\/]+/g, "")
      .replace(/\.(mp4|webm)$/i, "") || "video";

  let stem = String(rawName ?? "").trim();
  // Strip path separators and parent-traversal sequences safely
  stem = stem.replace(/[\\/]+/g, "").replace(/\.\.+/g, ".");
  while (/\.(mp4|webm)$/i.test(stem)) {
    stem = stem.replace(/\.(mp4|webm)$/i, "");
  }
  stem = stem.replace(/\s+/g, "-").replace(/[^A-Za-z0-9._-]/g, "");
  stem = stem.replace(/^\.+/, "").slice(0, 96);
  if (!stem || !/^[A-Za-z0-9_-][A-Za-z0-9._-]{0,95}$/.test(stem)) {
    stem = fallbackStem;
  }
  return `${stem}.${safeExt}`;
}

export async function saveVideoToServer(courseId, episodeId, ext, blob, mimeType, rawFilename) {
  const safeExt = ext === "mp4" ? "mp4" : "webm";
  const resolvedMime = mimeType || (safeExt === "mp4" ? "video/mp4" : "video/webm");
  const filename = resolveOutputFilename(rawFilename, episodeId, safeExt);
  const saveResp = await fetch(
    `/api/save-video?course=${encodeURIComponent(courseId)}&episode=${encodeURIComponent(episodeId)}&ext=${encodeURIComponent(safeExt)}&filename=${encodeURIComponent(filename)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": resolvedMime,
        "X-Video-Filename": filename,
      },
      body: blob,
    }
  );
  if (!saveResp.ok) {
    let detail = `HTTP ${saveResp.status}`;
    try {
      const body = await saveResp.json();
      if (body?.error) detail = body.error;
    } catch {
      // Ignore parse error
    }
    throw new Error(detail);
  }
  return saveResp.json();
}

async function exportEpisodeMediaRecorder({
  courseId,
  episode,
  resolution = "1080p",
  fps = 60,
  speed = 1,
  outputFilename,
  filename,
  onProgress,
  throwOnSaveError = false,
}) {
  const opts = normalizeExportOptions({ format: "webm", codec: "vp9", hardware: "auto", resolution, fps, speed });
  const script = episode.script;
  const scenes = script.scenes || [];
  if (!scenes.length) throw new Error("Tập học chưa có phân cảnh nào.");

  const W = opts.width;
  const H = opts.height;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  const audioCtx = new AudioContext();
  const dest = audioCtx.createMediaStreamDestination();
  const needStretch = Math.abs(opts.speed - 1) >= 1e-4;

  // Decode & optionally WSOLA-stretch all scene audio buffers upfront so timing is exact
  const buffers = [];
  for (let i = 0; i < scenes.length; i++) {
    const sc = scenes[i];
    onProgress?.({
      phase: "loading",
      label: `Đang tải âm thanh cảnh ${i + 1}/${scenes.length}...`,
      percent: 5 + Math.round((i / scenes.length) * 15),
    });
    if (!sc.audio_file) {
      const origDur = Number(sc.duration_sec) || 5;
      const silentFrames = Math.max(1, Math.round((origDur / opts.speed) * audioCtx.sampleRate));
      buffers.push(audioCtx.createBuffer(EXPORT_AUDIO_CHANNELS, silentFrames, audioCtx.sampleRate));
      continue;
    }
    const resp = await fetch(`${episode.base_url}/${sc.audio_file}`);
    if (!resp.ok) {
      throw new Error(`Không thể tải audio ${sc.audio_file} (HTTP ${resp.status})`);
    }
    const arr = await resp.arrayBuffer();
    let decoded = await audioCtx.decodeAudioData(arr);
    if (needStretch) {
      decoded = timeStretchAudioBuffer(decoded, opts.speed, {
        audioContext: audioCtx,
        sampleRate: decoded.sampleRate,
      });
    }
    buffers.push(decoded);
  }

  const videoStream = canvas.captureStream(opts.fps);
  const combinedStream = new MediaStream([
    ...videoStream.getVideoTracks(),
    ...dest.stream.getAudioTracks(),
  ]);

  const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
    ? "video/webm;codecs=vp9,opus"
    : "video/webm";
  const recorder = new MediaRecorder(combinedStream, {
    mimeType,
    videoBitsPerSecond: opts.bitrate,
  });

  const chunks = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  const sceneDurs = buffers.map((b) => b.length / b.sampleRate);
  const totalDur = sceneDurs.reduce((acc, d) => acc + d, 0);
  const stoppedPromise = new Promise((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: "video/webm" }));
  });

  const fxState = createInitialFxState(LOGICAL_WIDTH, LOGICAL_HEIGHT);
  recorder.start(250);

  let elapsedBefore = 0;
  for (let i = 0; i < scenes.length; i++) {
    const sc = scenes[i];
    const buf = buffers[i];
    const dur = sceneDurs[i];

    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    src.connect(dest);
    src.start();

    const startPerf = performance.now();
    await new Promise((resolve) => {
      function tick() {
        const sceneTime = (performance.now() - startPerf) / 1000;
        const clampedSceneTime = Math.min(sceneTime, dur);
        const globalTimeSec = elapsedBefore + clampedSceneTime;
        const globalProg = globalTimeSec / Math.max(0.1, totalDur);

        drawSceneFrame(
          ctx,
          W,
          H,
          script,
          sc,
          i,
          clampedSceneTime,
          dur,
          globalTimeSec,
          globalProg,
          fxState,
          opts.speed
        );

        onProgress?.({
          phase: "recording",
          label: `Đang xuất cảnh ${i + 1}/${scenes.length} (${Math.round(globalProg * 100)}%)`,
          percent: 20 + Math.round(globalProg * 75),
        });
        if (sceneTime >= dur) {
          resolve();
        } else {
          requestAnimationFrame(tick);
        }
      }
      requestAnimationFrame(tick);
    });

    elapsedBefore += dur;
  }

  recorder.stop();
  const blob = await stoppedPromise;
  await audioCtx.close();

  const resolvedFilename = resolveOutputFilename(outputFilename ?? filename, episode.id, "webm");
  onProgress?.({ phase: "saving", label: `Đang lưu file ${resolvedFilename} vào ổ đĩa...`, percent: 97 });
  let saved = null;
  try {
    saved = await saveVideoToServer(courseId, episode.id, "webm", blob, "video/webm", resolvedFilename);
    onProgress?.({ phase: "done", label: `Đã lưu thành công: ${saved.path}`, percent: 100 });
  } catch (err) {
    if (throwOnSaveError) throw err;
    onProgress?.({
      phase: "done",
      label: `Đã xuất ${resolvedFilename} (tải trực tiếp qua trình duyệt; lưu server thất bại: ${err.message})`,
      percent: 100,
    });
  }
  const savedFile = saved?.file || resolvedFilename;
  return {
    blob,
    saved,
    savedFile,
    format: "webm",
    ext: "webm",
    codec: "vp9",
    hardware: "auto",
    resolution: opts.resolution,
    width: W,
    height: H,
    fps: opts.fps,
    speed: opts.speed,
    mimeType: "video/webm",
    filename: savedFile,
    durationSec: totalDur,
    bytes: blob.size,
  };
}

export async function exportEpisodeFast({
  courseId,
  episode,
  format = "mp4",
  codec,
  hardware = "auto",
  resolution = "1080p",
  fps = 60,
  speed = 1,
  outputFilename,
  filename,
  onProgress,
  throwOnSaveError = false,
}) {
  const script = episode?.script;
  const scenes = script?.scenes || [];
  if (!scenes.length) throw new Error("Tập học chưa có phân cảnh nào.");

  const requestedFilename = outputFilename ?? filename;
  const profile = await resolveWebCodecsProfile({ format, codec, hardware, resolution, fps, speed });
  if (!profile) {
    onProgress?.({
      phase: "starting",
      label: "WebCodecs không khả dụng, chuyển sang MediaRecorder dự phòng...",
      percent: 3,
    });
    return exportEpisodeMediaRecorder({
      courseId,
      episode,
      resolution,
      fps,
      speed,
      outputFilename: requestedFilename,
      onProgress,
      throwOnSaveError,
    });
  }

  const W = profile.width;
  const H = profile.height;
  const outFps = profile.fps;
  const outSpeed = profile.speed;

  onProgress?.({
    phase: "starting",
    label: `Đang nạp muxer ${profile.format.toUpperCase()} (${profile.videoConfig.codec}, ${W}x${H}@${outFps}fps, ${outSpeed}x, ${profile.hardwareAcceleration})...`,
    percent: 3,
  });

  const MuxerPkg = await loadMuxerModule(profile.format);
  const buffers = await decodeSceneAudioBuffers(episode, scenes, onProgress, outSpeed);

  const sceneDurs = buffers.map((b) => b.length / EXPORT_AUDIO_SAMPLE_RATE);
  const sceneStarts = [];
  const sceneEnds = [];
  let accDur = 0;
  for (const d of sceneDurs) {
    sceneStarts.push(accDur);
    accDur += d;
    sceneEnds.push(accDur);
  }
  const totalDur = accDur;
  const totalFrames = Math.max(1, Math.ceil(totalDur * outFps));

  const target = new MuxerPkg.ArrayBufferTarget();
  const muxer =
    profile.format === "mp4"
      ? new MuxerPkg.Muxer({
          target,
          video: { codec: profile.muxerVideoCodec, width: W, height: H, frameRate: outFps },
          audio: {
            codec: profile.muxerAudioCodec,
            numberOfChannels: EXPORT_AUDIO_CHANNELS,
            sampleRate: EXPORT_AUDIO_SAMPLE_RATE,
          },
          fastStart: "in-memory",
          firstTimestampBehavior: "offset",
        })
      : new MuxerPkg.Muxer({
          target,
          video: { codec: profile.muxerVideoCodec, width: W, height: H, frameRate: outFps },
          audio: {
            codec: profile.muxerAudioCodec,
            numberOfChannels: EXPORT_AUDIO_CHANNELS,
            sampleRate: EXPORT_AUDIO_SAMPLE_RATE,
          },
          firstTimestampBehavior: "offset",
        });

  let encoderError = null;
  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => {
      try {
        muxer.addVideoChunk(chunk, meta);
      } catch (err) {
        encoderError = err;
      }
    },
    error: (err) => {
      encoderError = err;
    },
  });
  videoEncoder.configure(profile.videoConfig);

  const audioEncoder = new AudioEncoder({
    output: (chunk, meta) => {
      try {
        muxer.addAudioChunk(chunk, meta);
      } catch (err) {
        encoderError = err;
      }
    },
    error: (err) => {
      encoderError = err;
    },
  });
  audioEncoder.configure(profile.audioConfig);

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  const fxState = createInitialFxState(LOGICAL_WIDTH, LOGICAL_HEIGHT);

  // Interleaved audio + video encoding cursor so muxer Clusters stay strictly monotonic
  const AUDIO_CHUNK_SAMPLES = 4096;
  let audioSceneIdx = 0;
  let audioOffsetInScene = 0;
  let audioSampleCursor = 0;

  function encodeAudioUpToSample(targetSample) {
    while (audioSceneIdx < buffers.length && audioSampleCursor < targetSample) {
      if (encoderError) throw encoderError;
      const buf = buffers[audioSceneIdx];
      const remainingInScene = buf.length - audioOffsetInScene;
      if (remainingInScene <= 0) {
        audioSceneIdx++;
        audioOffsetInScene = 0;
        continue;
      }
      const count = Math.min(AUDIO_CHUNK_SAMPLES, remainingInScene);
      const ch0 = buf.getChannelData(0);
      const ch1 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : ch0;
      const planar = new Float32Array(count * 2);
      planar.set(ch0.subarray(audioOffsetInScene, audioOffsetInScene + count), 0);
      planar.set(ch1.subarray(audioOffsetInScene, audioOffsetInScene + count), count);

      const timestampUs = Math.round((audioSampleCursor / EXPORT_AUDIO_SAMPLE_RATE) * 1_000_000);
      const audioData = new AudioData({
        format: "f32-planar",
        sampleRate: EXPORT_AUDIO_SAMPLE_RATE,
        numberOfFrames: count,
        numberOfChannels: EXPORT_AUDIO_CHANNELS,
        timestamp: timestampUs,
        data: planar,
      });
      audioEncoder.encode(audioData);
      audioData.close();

      audioOffsetInScene += count;
      audioSampleCursor += count;
    }
  }

  try {
    let sceneCursor = 0;
    let lastLoggedPct = -1;

    for (let frameIdx = 0; frameIdx < totalFrames; frameIdx++) {
      if (encoderError) throw encoderError;

      const globalTimeSec = frameIdx / outFps;
      while (sceneCursor < scenes.length - 1 && globalTimeSec >= sceneEnds[sceneCursor]) {
        sceneCursor++;
      }

      const sc = scenes[sceneCursor];
      const dur = Math.max(0.1, sceneDurs[sceneCursor]);
      const sceneTime = Math.max(0, Math.min(dur, globalTimeSec - sceneStarts[sceneCursor]));
      const globalProg = clamp01(globalTimeSec / Math.max(0.1, totalDur));

      drawSceneFrame(
        ctx,
        W,
        H,
        script,
        sc,
        sceneCursor,
        sceneTime,
        dur,
        globalTimeSec,
        globalProg,
        fxState,
        outSpeed
      );

      const timestampUs = Math.round((frameIdx * 1_000_000) / outFps);
      const nextTimestampUs = Math.round(((frameIdx + 1) * 1_000_000) / outFps);
      const frame = new VideoFrame(canvas, {
        timestamp: timestampUs,
        duration: Math.max(1, nextTimestampUs - timestampUs),
      });
      videoEncoder.encode(frame, { keyFrame: frameIdx % (outFps * 2) === 0 });
      frame.close();

      const targetAudioSample = Math.round(((frameIdx + 1) / outFps) * EXPORT_AUDIO_SAMPLE_RATE);
      encodeAudioUpToSample(targetAudioSample);

      const pct = 20 + Math.round((frameIdx / totalFrames) * 75);
      if (pct !== lastLoggedPct && (frameIdx % 15 === 0 || frameIdx === totalFrames - 1)) {
        lastLoggedPct = pct;
        onProgress?.({
          phase: "recording",
          label: `Render ${profile.format.toUpperCase()} (${profile.resolution} ${outFps}fps) — cảnh ${sceneCursor + 1}/${scenes.length} (${Math.round(globalProg * 100)}%)`,
          percent: pct,
        });
      }

      while (videoEncoder.encodeQueueSize > 6 || audioEncoder.encodeQueueSize > 16) {
        if (encoderError) throw encoderError;
        await sleep(2);
      }
      if (frameIdx % 12 === 0) {
        await sleep(0);
      }
    }

    // Flush any remaining trailing audio samples
    encodeAudioUpToSample(Number.MAX_SAFE_INTEGER);
    if (encoderError) throw encoderError;

    onProgress?.({ phase: "recording", label: "Đang đóng gói video (muxing)...", percent: 96 });
    await Promise.all([videoEncoder.flush(), audioEncoder.flush()]);
    if (encoderError) throw encoderError;
  } finally {
    if (videoEncoder.state !== "closed") videoEncoder.close();
    if (audioEncoder.state !== "closed") audioEncoder.close();
  }

  muxer.finalize();
  const blob = new Blob([target.buffer], { type: profile.mimeType });
  const resolvedFilename = resolveOutputFilename(requestedFilename, episode.id, profile.ext);

  onProgress?.({
    phase: "saving",
    label: `Đang lưu file ${resolvedFilename} vào ổ đĩa...`,
    percent: 98,
  });

  let saved = null;
  try {
    saved = await saveVideoToServer(courseId, episode.id, profile.ext, blob, profile.mimeType, resolvedFilename);
    onProgress?.({ phase: "done", label: `Đã lưu thành công: ${saved.path}`, percent: 100 });
  } catch (err) {
    if (throwOnSaveError) throw err;
    onProgress?.({
      phase: "done",
      label: `Đã xuất ${resolvedFilename} (tải trực tiếp qua trình duyệt; lưu server thất bại: ${err.message})`,
      percent: 100,
    });
  }

  const savedFile = saved?.file || resolvedFilename;
  return {
    blob,
    saved,
    savedFile,
    format: profile.format,
    ext: profile.ext,
    codec: profile.codec,
    hardware: profile.hardware,
    hardwareAcceleration: profile.hardwareAcceleration,
    resolution: profile.resolution,
    width: W,
    height: H,
    fps: outFps,
    speed: outSpeed,
    mimeType: profile.mimeType,
    filename: savedFile,
    durationSec: totalDur,
    bytes: blob.size,
  };
}

export async function exportEpisodeVideo({
  courseId,
  episode,
  onProgress,
  format = "mp4",
  codec,
  hardware = "auto",
  resolution = "1080p",
  fps = 60,
  speed = 1,
  outputFilename,
  filename,
}) {
  return exportEpisodeFast({
    courseId,
    episode,
    format,
    codec,
    hardware,
    resolution,
    fps,
    speed,
    outputFilename,
    filename,
    onProgress,
    throwOnSaveError: false,
  });
}

if (typeof window !== "undefined") {
  window.__STUDIO_RENDER_OFFLINE__ = async ({
    courseId,
    episodeId,
    format = "mp4",
    codec,
    hardware = "auto",
    resolution = "1080p",
    fps = 60,
    speed = 1,
    outputFilename,
    filename,
  } = {}) => {
    if (!courseId || !episodeId) {
      throw new Error("Thiếu courseId hoặc episodeId.");
    }
    const resp = await fetch("/api/courses", { cache: "no-store" });
    if (!resp.ok) {
      throw new Error(`Không thể tải /api/courses (HTTP ${resp.status})`);
    }
    const data = await resp.json();
    const course = (data.courses || []).find((c) => c.id === courseId);
    if (!course) {
      throw new Error(`Không tìm thấy khóa học: ${courseId}`);
    }
    const episode = (course.episodes || []).find((e) => e.id === episodeId);
    if (!episode) {
      throw new Error(`Không tìm thấy tập học: ${episodeId}`);
    }
    if (!episode.script?.scenes?.length) {
      throw new Error(`Tập ${episodeId} chưa có script.json hợp lệ.`);
    }

    let lastLogPct = -10;
    const result = await exportEpisodeFast({
      courseId,
      episode,
      format,
      codec,
      hardware,
      resolution,
      fps,
      speed,
      outputFilename,
      filename,
      throwOnSaveError: true,
      onProgress: (p) => {
        if (
          typeof p?.percent === "number" &&
          (p.percent - lastLogPct >= 5 || p.percent === 100 || p.phase === "saving")
        ) {
          lastLogPct = p.percent;
          console.log(`[OFFLINE_RENDER] [render] ${p.percent}% (${p.phase}) ${p.label}`);
        }
      },
    });

    const savedFile = result.saved?.file || result.savedFile || result.filename;
    return {
      ok: true,
      path: result.saved?.path || "",
      savedFile,
      filename: savedFile,
      bytes: result.saved?.bytes ?? result.bytes,
      format: result.format,
      ext: result.ext,
      codec: result.codec,
      hardware: result.hardware,
      hardwareAcceleration: result.hardwareAcceleration,
      resolution: result.resolution,
      width: result.width,
      height: result.height,
      fps: result.fps,
      speed: result.speed,
      durationSec: Number(result.durationSec.toFixed(3)),
    };
  };
}
