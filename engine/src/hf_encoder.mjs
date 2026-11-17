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
} from "./exporter.mjs";

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

/** Mix all clips into one planar stereo buffer covering the whole composition. */
async function buildAudioMix(clips, totalDuration) {
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
  for (let k = 0; k < total; k++) {
    if (left[k] > 1) left[k] = 1;
    else if (left[k] < -1) left[k] = -1;
    if (right[k] > 1) right[k] = 1;
    else if (right[k] < -1) right[k] = -1;
  }
  return { left, right, total };
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
    throw new Error("WebCodecs (VideoEncoder/AudioEncoder) không khả dụng trong Chrome này. Dùng --engine legacy.");
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

  S = {
    config,
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

  S.mix = await buildAudioMix(Array.isArray(config.audio) ? config.audio : [], Number(config.totalDuration) || 0);
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
  const { profile, config } = S;
  const blob = new Blob([S.target.buffer], { type: profile.mimeType });
  const filename = resolveOutputFilename(config.outputFilename, config.episodeId, profile.ext);
  log(`muxed ${S.nextIndex} frames → ${(blob.size / 1024 / 1024).toFixed(2)} MB, saving ${filename}`);
  const saved = await saveVideoToServer(config.courseId, config.episodeId, profile.ext, blob, profile.mimeType, filename);
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

window.__TVS_HF_ENCODER__ = { init, pushFrame, finish, abort };
window.__TVS_HF_ENCODER_READY__ = true;
