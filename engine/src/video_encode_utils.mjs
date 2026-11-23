// Shared WebCodecs, muxer, WSOLA audio time-stretch, and video upload helpers.
// Used by engine/src/hf_encoder.mjs in the browser encoder page (/public/hf-encoder.html).

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

export function computeTargetVideoBitrate({ resolution = "1080p", fps = 30, codec = "h264" } = {}) {
  const resKey = RESOLUTION_PRESETS[resolution] ? resolution : "1080p";
  const base60 = BASE_60FPS_BITRATES[resKey] || 12_000_000;
  const numFps = Number(fps) || 30;
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
  fps = 30,
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

  const normFps = Number(fps ?? 30);
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

export async function saveVideoToServer(courseId, episodeId, ext, blob, mimeType, rawFilename, partId = "") {
  const safeExt = ext === "mp4" ? "mp4" : "webm";
  const resolvedMime = mimeType || (safeExt === "mp4" ? "video/mp4" : "video/webm");
  const cleanPartId = String(partId || "").trim();
  const filename = resolveOutputFilename(rawFilename, cleanPartId || episodeId, safeExt);
  const headers = {
    "Content-Type": resolvedMime,
    "X-Video-Filename": filename,
  };
  let saveUrl = `/api/save-video?course=${encodeURIComponent(courseId)}&episode=${encodeURIComponent(episodeId)}&ext=${encodeURIComponent(safeExt)}&filename=${encodeURIComponent(filename)}`;
  if (cleanPartId) {
    saveUrl += `&part=${encodeURIComponent(cleanPartId)}`;
    headers["X-Part-Id"] = cleanPartId;
  }
  const saveResp = await fetch(saveUrl, {
    method: "POST",
    headers,
    body: blob,
  });
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
