#!/usr/bin/env node
// Generates 6 clean, deterministic 48kHz mono 16-bit PCM WAV SFX files in engine/assets/sfx/.
// Pure Node.js DSP, zero external binaries.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const ENGINE_DIR = path.resolve(path.dirname(__filename), "..");
const OUT_DIR = path.join(ENGINE_DIR, "assets", "sfx");
const SR = 48000;
const PEAK_TARGET = 0.501187; // -6 dBFS

function createRng(seed = 20261119) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let z = Math.imul(state ^ (state >>> 15), 1 | state);
    z = (z + Math.imul(z ^ (z >>> 7), 61 | z)) ^ z;
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}

function encodeMonoWav(samples, sampleRate = SR) {
  let maxAbs = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    if (a > maxAbs) maxAbs = a;
  }
  const scale = maxAbs > 1e-6 ? PEAK_TARGET / maxAbs : 0;

  const dataBytes = samples.length * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataBytes, 40);

  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i] * scale));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return buf;
}

function makeWhooshShort() {
  const dur = 0.24;
  const n = Math.round(dur * SR);
  const out = new Float32Array(n);
  const rand = createRng(101);
  let lp = 0;
  let hpPrevIn = 0;
  let hpPrevOut = 0;
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    const env = Math.sin(Math.PI * u) ** 1.35;
    const white = rand() * 2 - 1;
    // Dynamic sweep low-pass + gentle high-pass
    const cutoff = 420 + 2600 * Math.sin(Math.PI * u);
    const alpha = Math.min(0.85, (2 * Math.PI * cutoff) / (SR + 2 * Math.PI * cutoff));
    lp = lp + alpha * (white - lp);
    const hp = 0.94 * (hpPrevOut + lp - hpPrevIn);
    hpPrevIn = lp;
    hpPrevOut = hp;
    const airyTone = 0.14 * Math.sin(2 * Math.PI * (240 + 280 * u) * (i / SR));
    out[i] = (hp * 0.85 + airyTone) * env;
  }
  return out;
}

function makePop() {
  const dur = 0.09;
  const n = Math.round(dur * SR);
  const out = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const u = i / (n - 1);
    const freq = 680 - 440 * (u ** 0.75);
    phase += (2 * Math.PI * freq) / SR;
    const env = Math.min(1, t / 0.004) * Math.exp(-34 * t);
    const tri = (2 / Math.PI) * Math.asin(Math.sin(phase));
    out[i] = (0.75 * Math.sin(phase) + 0.25 * tri) * env;
  }
  return out;
}

function makeClick() {
  const dur = 0.045;
  const n = Math.round(dur * SR);
  const out = new Float32Array(n);
  const rand = createRng(202);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const freq = 1850 - 750 * (i / n);
    phase += (2 * Math.PI * freq) / SR;
    const env = Math.min(1, t / 0.0015) * Math.exp(-95 * t);
    const snap = (rand() * 2 - 1) * Math.exp(-160 * t) * 0.35;
    out[i] = (Math.sin(phase) * 0.8 + snap) * env;
  }
  return out;
}

function makeTypingFast() {
  const dur = 0.22;
  const n = Math.round(dur * SR);
  const out = new Float32Array(n);
  const rand = createRng(303);
  const offsets = [0.002, 0.044, 0.088, 0.134, 0.178];
  offsets.forEach((off, idx) => {
    const startIdx = Math.round(off * SR);
    const pitch = 1350 + (idx % 3) * 210;
    let ph = 0;
    const tapLen = Math.round(0.028 * SR);
    for (let j = 0; j < tapLen && startIdx + j < n; j++) {
      const t = j / SR;
      ph += (2 * Math.PI * pitch) / SR;
      const env = Math.min(1, t / 0.0012) * Math.exp(-130 * t);
      const transient = (rand() * 2 - 1) * Math.exp(-220 * t) * 0.45;
      out[startIdx + j] += (Math.sin(ph) * 0.65 + transient) * env;
    }
  });
  return out;
}

function makeImpact() {
  const dur = 0.28;
  const n = Math.round(dur * SR);
  const out = new Float32Array(n);
  const rand = createRng(404);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const u = i / (n - 1);
    const freq = 140 - 94 * (u ** 0.5);
    phase += (2 * Math.PI * freq) / SR;
    const subEnv = Math.min(1, t / 0.004) * Math.exp(-12 * t);
    const snapEnv = Math.min(1, t / 0.001) * Math.exp(-90 * t);
    const sub = Math.sin(phase) + 0.25 * Math.sin(phase * 2.02);
    const snap = ((rand() * 2 - 1) * 0.5 + Math.sin(2 * Math.PI * 820 * t) * 0.5) * snapEnv;
    out[i] = sub * subEnv * 0.85 + snap * 0.35;
  }
  return out;
}

function makeChime() {
  const dur = 0.38;
  const n = Math.round(dur * SR);
  const out = new Float32Array(n);
  const d5 = 587.33;
  const a5 = 880.0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const env1 = Math.min(1, t / 0.006) * Math.exp(-7.5 * t);
    const env2 = t >= 0.045 ? Math.min(1, (t - 0.045) / 0.006) * Math.exp(-7.5 * (t - 0.045)) : 0;
    const s1 = (Math.sin(2 * Math.PI * d5 * t) + 0.22 * Math.sin(2 * Math.PI * d5 * 2 * t)) * env1;
    const s2 = (Math.sin(2 * Math.PI * a5 * t) + 0.18 * Math.sin(2 * Math.PI * a5 * 2 * t)) * env2;
    out[i] = s1 * 0.65 + s2 * 0.65;
  }
  return out;
}

export function generateAllSfx(outDir = OUT_DIR) {
  fs.mkdirSync(outDir, { recursive: true });
  const specs = [
    ["whoosh_short.wav", makeWhooshShort()],
    ["pop.wav", makePop()],
    ["click.wav", makeClick()],
    ["typing_fast.wav", makeTypingFast()],
    ["impact.wav", makeImpact()],
    ["chime.wav", makeChime()],
  ];
  const written = [];
  for (const [name, samples] of specs) {
    const filePath = path.join(outDir, name);
    const wav = encodeMonoWav(samples, SR);
    fs.writeFileSync(filePath, wav);
    written.push({ name, filePath, bytes: wav.length, durationSec: Number((samples.length / SR).toFixed(3)) });
  }
  return written;
}

if (path.resolve(process.argv[1] || "") === __filename) {
  const files = generateAllSfx();
  for (const f of files) {
    console.log(`[sfx] ${f.name}: ${f.durationSec}s (${f.bytes} bytes)`);
  }
}
