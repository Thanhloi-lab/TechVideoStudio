// HyperFrames render — in-browser encoder (WebCodecs + vendored mp4-muxer / webm-muxer).
// Loaded by /public/hf-encoder.html and driven over CDP by engine/hyperframes/render.mjs:
//
//   await __TVS_HF_ENCODER__.init(config)        → profile summary
//   await __TVS_HF_ENCODER__.pushFrame(i, b64)    (frames strictly in order, JPEG/PNG base64)
//   await __TVS_HF_ENCODER__.finish()             → { ok, savedFile, bytes, ... } (saved via /api/save-video)
//
// Audio: every <audio> clip of the composition is decoded, resampled to 48 kHz stereo,
// pitch-preserving time-stretched (WSOLA) when playback_rate ≠ 1, mixed at its data-start offset,
// trimmed to its data-duration and encoded interleaved with video (AAC for MP4, Opus for WebM).

import {
  EXPORT_AUDIO_CHANNELS,
  EXPORT_AUDIO_SAMPLE_RATE,
  loadMuxerModule,
  resolveOutputFilename,
  resolveWebCodecsProfile,
  saveVideoToServer,
  timeStretchAudioBuffer,
} from "./video_encode_utils.mjs";
import { measureIntegratedLufs, normalizeLoudnessAndLimit } from "./audio_dsp.mjs";

const SR = EXPORT_AUDIO_SAMPLE_RATE;
const CH = EXPORT_AUDIO_CHANNELS;
const AUDIO_CHUNK = 4096;

let S = null;

function log(msg) {
  console.log(`[hf-encoder] ${msg}`);
}

function waitForQueue(encoder, max) {
  if (encoder.encodeQueueSize <= max) return Promise.resolve();
  return new Promise((resolve) => {
    const onDequeue = () => {
      if (encoder.encodeQueueSize <= max || encoder.state === "closed") {
        encoder.removeEventListener("dequeue", onDequeue);
        resolve();
      }
    };
    encoder.addEventListener("dequeue", onDequeue);
  });
}

async function decodeToStereo48k(arrayBuffer) {
  const decodeCtx = new OfflineAudioContext(CH, 1, SR);
  const decoded = await decodeCtx.decodeAudioData(arrayBuffer);
  if (decoded.sampleRate === SR && decoded.numberOfChannels === CH) return decoded;
  const frames = Math.max(1, Math.round(decoded.duration * SR));
  const ctx = new OfflineAudioContext(CH, frames, SR);
  const src = ctx.createBufferSource();
  src.buffer = decoded;
  src.connect(ctx.destination);
  src.start(0);
  return ctx.startRendering();
}

async function applyVocalCarveEq(audioBuf, { carveHz = 1800, carveDb = -6 } = {}) {
  const frames = Math.max(1, audioBuf.length);
  const ctx = new OfflineAudioContext(CH, frames, SR);
  const src = ctx.createBufferSource();
  src.buffer = audioBuf;
  const eq = ctx.createBiquadFilter();
  eq.type = "peaking";
  eq.frequency.value = Number(carveHz) || 1800;
  eq.Q.value = 1.4;
  eq.gain.value = Number.isFinite(Number(carveDb)) ? Number(carveDb) : -6;
  src.connect(eq);
  eq.connect(ctx.destination);
  src.start(0);
  return ctx.startRendering();
}

/** Mix narration clips + programmatic SFX bus + optional carved BGM bed, then normalize to target LUFS. */
async function buildAudioMix({ clips = [], sfx = [], bgm = null, totalDuration = 0, targetLufs = -16 }) {
  const total = Math.max(1, Math.round(totalDuration * SR));
  const left = new Float32Array(total);
  const right = new Float32Array(total);
  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    const resp = await fetch(clip.url);
    if (!resp.ok) throw new Error(`Không thể tải audio ${clip.url} (HTTP ${resp.status})`);
    let buf = await decodeToStereo48k(await resp.arrayBuffer());
    const rate = Number(clip.playback_rate) || 1;
    if (Math.abs(rate - 1) >= 1e-4) {
      buf = timeStretchAudioBuffer(buf, rate, { sampleRate: SR });
    }
    const mediaStart = Math.max(0, Math.round((Number(clip.media_start) || 0) * SR));
    const offset = Math.max(0, Math.round((Number(clip.start) || 0) * SR));
    const slot = Math.max(0, Math.round((Number(clip.duration) || 0) * SR));
    const avail = Math.max(0, buf.length - mediaStart);
    const len = Math.min(avail, slot || avail, total - offset);
    const vol = Number.isFinite(Number(clip.volume)) ? Number(clip.volume) : 1;
    const l = buf.getChannelData(0);
    const r = buf.numberOfChannels > 1 ? buf.getChannelData(1) : l;
    for (let k = 0; k < len; k++) {
      left[offset + k] += l[mediaStart + k] * vol;
      right[offset + k] += r[mediaStart + k] * vol;
    }
    log(`audio ${i + 1}/${clips.length} mixed @${(offset / SR).toFixed(3)}s (${(len / SR).toFixed(3)}s, rate ${rate})`);
  }

  // Mix SFX bus cues (each unique SFX WAV fetched/decoded once)
  if (Array.isArray(sfx) && sfx.length > 0) {
    const sfxCache = new Map();
    for (const cue of sfx) {
      if (!cue?.url) continue;
      let buf = sfxCache.get(cue.url);
      if (buf === undefined) {
        try {
          const resp = await fetch(cue.url);
          if (resp.ok) {
            buf = await decodeToStereo48k(await resp.arrayBuffer());
          } else {
            buf = null;
          }
        } catch {
          buf = null;
        }
        sfxCache.set(cue.url, buf);
      }
      if (!buf) continue;
      const offset = Math.max(0, Math.round((Number(cue.start) || 0) * SR));
      if (offset >= total) continue;
      const len = Math.min(buf.length, total - offset);
      const gain = (Number.isFinite(Number(cue.volume)) ? Number(cue.volume) : 0.65) * 0.65;
      const l = buf.getChannelData(0);
      const r = buf.numberOfChannels > 1 ? buf.getChannelData(1) : l;
      for (let k = 0; k < len; k++) {
        left[offset + k] += l[k] * gain;
        right[offset + k] += r[k] * gain;
      }
    }
  }

  // Optional background music bed with 1800Hz -6dB static EQ carve for vocal clarity
  if (bgm?.url) {
    try {
      const resp = await fetch(bgm.url);
      if (resp.ok) {
        const rawBgm = await decodeToStereo48k(await resp.arrayBuffer());
        const carvedBgm = await applyVocalCarveEq(rawBgm, {
          carveHz: bgm.carve_hz || 1800,
          carveDb: bgm.carve_db ?? -6,
        });
        const bl = carvedBgm.getChannelData(0);
        const br = carvedBgm.numberOfChannels > 1 ? carvedBgm.getChannelData(1) : bl;
        const bLen = carvedBgm.length;
        const bgmVol = Number.isFinite(Number(bgm.volume)) ? Number(bgm.volume) : 0.14;
        const fadeSamples = Math.min(Math.round(0.45 * SR), Math.floor(total / 4));
        if (bLen > 0) {
          for (let k = 0; k < total; k++) {
            const bIdx = k % bLen;
            let env = 1;
            if (fadeSamples > 0) {
              if (k < fadeSamples) env = k / fadeSamples;
              else if (k > total - fadeSamples) env = (total - k) / fadeSamples;
            }
            left[k] += bl[bIdx] * bgmVol * env;
            right[k] += br[bIdx] * bgmVol * env;
          }
        }
      }
    } catch (err) {
      log(`bgm skipped: ${err?.message || err}`);
    }
  }

  let loudness = null;
  if (targetLufs !== null && targetLufs !== false && Number.isFinite(Number(targetLufs))) {
    loudness = normalizeLoudnessAndLimit(left, right, {
      sampleRate: SR,
      targetLufs: Number(targetLufs),
    });
    log(
      `mixed ${clips.length} voice + ${sfx.length} sfx${bgm?.url ? " + bgm" : ""}; loudness ${loudness.inputLufs} -> ${loudness.outputLufs} LUFS (gain ${loudness.gainDb >= 0 ? "+" : ""}${loudness.gainDb} dB, peak ${loudness.peak})`
    );
  } else {
    for (let k = 0; k < total; k++) {
      if (left[k] > 1) left[k] = 1;
      else if (left[k] < -1) left[k] = -1;
      if (right[k] > 1) right[k] = 1;
      else if (right[k] < -1) right[k] = -1;
    }
    loudness = measureIntegratedLufs(left, right, SR);
  }

  return { left, right, total, loudness };
}

function encodeAudioUpTo(targetSample) {
  const { mix } = S;
  const end = Math.min(mix.total, targetSample);
  while (S.audioCursor < end) {
    if (S.error) throw S.error;
    const count = Math.min(AUDIO_CHUNK, end - S.audioCursor);
    const planar = new Float32Array(count * 2);
    planar.set(mix.left.subarray(S.audioCursor, S.audioCursor + count), 0);
    planar.set(mix.right.subarray(S.audioCursor, S.audioCursor + count), count);
    const data = new AudioData({
      format: "f32-planar",
      sampleRate: SR,
      numberOfFrames: count,
      numberOfChannels: CH,
      timestamp: Math.round((S.audioCursor / SR) * 1_000_000),
      data: planar,
    });
    S.audioEncoder.encode(data);
    data.close();
    S.audioCursor += count;
  }
}

async function init(config) {
  if (S) throw new Error("Encoder already initialized");
  const profile = await resolveWebCodecsProfile({
    format: config.format,
    codec: config.codec,
    hardware: config.hardware,
    resolution: config.resolution,
    fps: config.fps,
    speed: config.speed,
  });
  if (!profile) {
    throw new Error("WebCodecs (VideoEncoder/AudioEncoder) is unavailable in this Chrome build.");
  }
  const Muxer = await loadMuxerModule(profile.format);
  const target = new Muxer.ArrayBufferTarget();
  const common = {
    target,
    video: { codec: profile.muxerVideoCodec, width: profile.width, height: profile.height, frameRate: profile.fps },
    audio: { codec: profile.muxerAudioCodec, numberOfChannels: CH, sampleRate: SR },
    firstTimestampBehavior: "offset",
  };
  const muxer = new Muxer.Muxer(profile.format === "mp4" ? { ...common, fastStart: "in-memory" } : common);

  const partId = String(config.partId || config.part_id || "").trim();
  S = {
    config,
    partId,
    profile,
    muxer,
    target,
    error: null,
    nextIndex: 0,
    audioCursor: 0,
    mix: null,
    videoEncoder: null,
    audioEncoder: null,
  };

  S.videoEncoder = new VideoEncoder({
    output: (chunk, meta) => {
      try {
        muxer.addVideoChunk(chunk, meta);
      } catch (err) {
        S.error = err;
      }
    },
    error: (err) => {
      S.error = err;
    },
  });
  S.videoEncoder.configure(profile.videoConfig);
  S.audioEncoder = new AudioEncoder({
    output: (chunk, meta) => {
      try {
        muxer.addAudioChunk(chunk, meta);
      } catch (err) {
        S.error = err;
      }
    },
    error: (err) => {
      S.error = err;
    },
  });
  S.audioEncoder.configure(profile.audioConfig);

  S.mix = await buildAudioMix({
    clips: Array.isArray(config.audio) ? config.audio : [],
    sfx: Array.isArray(config.sfx) ? config.sfx : [],
    bgm: config.bgm || null,
    totalDuration: Number(config.totalDuration) || 0,
    targetLufs: config.loudnessTargetLufs !== undefined ? config.loudnessTargetLufs : -16,
  });
  log(
    `ready ${profile.format}/${profile.videoConfig.codec} ${profile.width}x${profile.height}@${profile.fps} hw=${profile.hardwareAcceleration} audio=${profile.audioConfig.codec}`
  );
  return {
    format: profile.format,
    codec: profile.codec,
    videoCodec: profile.videoConfig.codec,
    audioCodec: profile.audioConfig.codec,
    width: profile.width,
    height: profile.height,
    fps: profile.fps,
    bitrate: profile.bitrate,
    hardwareAcceleration: profile.hardwareAcceleration,
    audioSamples: S.mix.total,
    loudness: S.mix.loudness || null,
  };
}

async function pushFrame(index, base64, mime = "image/jpeg") {
  if (!S) throw new Error("Encoder not initialized");
  if (S.error) throw S.error;
  if (index !== S.nextIndex) throw new Error(`Out-of-order frame ${index} (expected ${S.nextIndex})`);
  const { fps, width, height } = S.profile;
  const blob = await (await fetch(`data:${mime};base64,${base64}`)).blob();
  const bitmap = await createImageBitmap(blob, { resizeWidth: width, resizeHeight: height, resizeQuality: "high" });
  const ts = Math.round((index * 1_000_000) / fps);
  const next = Math.round(((index + 1) * 1_000_000) / fps);
  const frame = new VideoFrame(bitmap, { timestamp: ts, duration: Math.max(1, next - ts) });
  bitmap.close();
  S.videoEncoder.encode(frame, { keyFrame: index % Math.max(1, Math.round(fps * 2)) === 0 });
  frame.close();
  S.nextIndex = index + 1;
  encodeAudioUpTo(Math.round(((index + 1) / fps) * SR));
  await waitForQueue(S.videoEncoder, 6);
  await waitForQueue(S.audioEncoder, 24);
  if (S.error) throw S.error;
  return S.nextIndex;
}

async function finish() {
  if (!S) throw new Error("Encoder not initialized");
  encodeAudioUpTo(Number.MAX_SAFE_INTEGER);
  await Promise.all([S.videoEncoder.flush(), S.audioEncoder.flush()]);
  if (S.error) throw S.error;
  S.videoEncoder.close();
  S.audioEncoder.close();
  S.muxer.finalize();
  const { profile, config, mix, partId } = S;
  const blob = new Blob([S.target.buffer], { type: profile.mimeType });
  const filename = resolveOutputFilename(config.outputFilename, partId || config.episodeId, profile.ext);
  log(`muxed ${S.nextIndex} frames → ${(blob.size / 1024 / 1024).toFixed(2)} MB, saving ${filename}${partId ? ` (part ${partId})` : ""}`);
  const saved = await saveVideoToServer(config.courseId, config.episodeId, profile.ext, blob, profile.mimeType, filename, partId);
  const result = {
    ok: true,
    path: saved?.path || "",
    savedFile: saved?.file || filename,
    bytes: saved?.bytes ?? blob.size,
    format: profile.format,
    ext: profile.ext,
    codec: profile.codec,
    hardwareAcceleration: profile.hardwareAcceleration,
    resolution: profile.resolution,
    width: profile.width,
    height: profile.height,
    fps: profile.fps,
    speed: profile.speed,
    frames: S.nextIndex,
    durationSec: Number((S.nextIndex / profile.fps).toFixed(3)),
    loudness: mix?.loudness || null,
  };
  S = null;
  return result;
}

function abort() {
  if (!S) return;
  try {
    if (S.videoEncoder?.state !== "closed") S.videoEncoder.close();
    if (S.audioEncoder?.state !== "closed") S.audioEncoder.close();
  } catch {
    // ignore
  }
  S = null;
}

window.__TVS_AUDIO_DSP__ = { measureIntegratedLufs, normalizeLoudnessAndLimit };
window.__TVS_HF_ENCODER__ = { init, pushFrame, finish, abort };
window.__TVS_HF_ENCODER_READY__ = true;
