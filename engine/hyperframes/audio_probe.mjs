// Pure-JS audio duration probe (zero deps) for WAV (RIFF/WAVE PCM & float) and MP3 (MPEG-1/2/2.5
// Layer III, CBR or VBR via Xing/Info/VBRI header or full frame scan).

import fs from "node:fs";

const MPEG_BITRATES = {
  // [versionKey][layerKey] kbps tables (index 0 = free, 15 = bad)
  1: {
    1: [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, 0],
    2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, 0],
    3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0],
  },
  2: {
    1: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256, 0],
    2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0],
    3: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0],
  },
};
const MPEG_SAMPLE_RATES = { 1: [44100, 48000, 32000], 2: [22050, 24000, 16000], 25: [11025, 12000, 8000] };

export function probeWavDuration(buf) {
  if (buf.length < 12 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    return null;
  }
  let offset = 12;
  let byteRate = 0;
  let dataBytes = null;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt " && body + 12 <= buf.length) {
      byteRate = buf.readUInt32LE(body + 8);
    } else if (id === "data") {
      dataBytes = Math.min(size, buf.length - body);
      break;
    }
    offset = body + size + (size % 2);
  }
  if (!byteRate || dataBytes === null) return null;
  return dataBytes / byteRate;
}

function parseMpegHeader(buf, i) {
  if (i + 4 > buf.length) return null;
  const b1 = buf[i];
  const b2 = buf[i + 1];
  const b3 = buf[i + 2];
  if (b1 !== 0xff || (b2 & 0xe0) !== 0xe0) return null;
  const verBits = (b2 >> 3) & 0x3;
  const layerBits = (b2 >> 1) & 0x3;
  if (verBits === 1 || layerBits === 0) return null;
  const version = verBits === 3 ? 1 : verBits === 2 ? 2 : 25;
  const layer = 4 - layerBits;
  const brIdx = (b3 >> 4) & 0xf;
  const srIdx = (b3 >> 2) & 0x3;
  if (brIdx === 0 || brIdx === 15 || srIdx === 3) return null;
  const padding = (b3 >> 1) & 0x1;
  const bitrate = MPEG_BITRATES[version === 1 ? 1 : 2][layer][brIdx] * 1000;
  const sampleRate = MPEG_SAMPLE_RATES[version][srIdx];
  const samplesPerFrame = layer === 1 ? 384 : layer === 3 && version !== 1 ? 576 : 1152;
  const frameLength =
    layer === 1
      ? Math.floor(((12 * bitrate) / sampleRate + padding) * 4)
      : Math.floor((samplesPerFrame / 8) * (bitrate / sampleRate)) + padding;
  const channelMode = (buf[i + 3] >> 6) & 0x3;
  return { version, layer, bitrate, sampleRate, samplesPerFrame, frameLength, channelMode };
}

function skipId3v2(buf) {
  if (buf.length >= 10 && buf.toString("ascii", 0, 3) === "ID3") {
    const size = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
    const footer = buf[5] & 0x10 ? 10 : 0;
    return 10 + size + footer;
  }
  return 0;
}

export function probeMp3Duration(buf) {
  let i = skipId3v2(buf);
  // Find the first valid frame (confirmed by a following frame header when possible)
  let first = null;
  for (; i < buf.length - 4; i++) {
    const h = parseMpegHeader(buf, i);
    if (!h || h.frameLength <= 0) continue;
    const next = parseMpegHeader(buf, i + h.frameLength);
    if (next || i + h.frameLength >= buf.length) {
      first = h;
      break;
    }
  }
  if (!first) return null;

  // Xing / Info (VBR & LAME CBR) header inside the first frame
  const sideInfo = first.version === 1 ? (first.channelMode === 3 ? 17 : 32) : first.channelMode === 3 ? 9 : 17;
  const xingPos = i + 4 + sideInfo;
  const tag = buf.toString("ascii", xingPos, xingPos + 4);
  if ((tag === "Xing" || tag === "Info") && xingPos + 12 <= buf.length) {
    const flags = buf.readUInt32BE(xingPos + 4);
    if (flags & 0x1) {
      const frames = buf.readUInt32BE(xingPos + 8);
      if (frames > 0) {
        let duration = (frames * first.samplesPerFrame) / first.sampleRate;
        // LAME encoder delay/padding (gapless info) lives 0x8D bytes after the tag when present
        const lamePos = xingPos + 0x78;
        if (buf.toString("ascii", lamePos, lamePos + 4) === "LAME" && lamePos + 0x18 <= buf.length) {
          const d = buf.readUIntBE(lamePos + 0x15, 3);
          const delay = d >> 12;
          const pad = d & 0xfff;
          duration = Math.max(0, (frames * first.samplesPerFrame - delay - pad) / first.sampleRate);
        }
        return duration;
      }
    }
  }
  // VBRI (Fraunhofer) header at fixed offset 32 after the frame header
  const vbriPos = i + 4 + 32;
  if (buf.toString("ascii", vbriPos, vbriPos + 4) === "VBRI" && vbriPos + 18 <= buf.length) {
    const frames = buf.readUInt32BE(vbriPos + 14);
    if (frames > 0) return (frames * first.samplesPerFrame) / first.sampleRate;
  }

  // Full frame scan (exact for CBR and VBR without headers)
  let samples = 0;
  let pos = i;
  while (pos < buf.length - 4) {
    const h = parseMpegHeader(buf, pos);
    if (!h || h.frameLength <= 0) {
      pos++;
      continue;
    }
    samples += h.samplesPerFrame;
    pos += h.frameLength;
  }
  return samples > 0 ? samples / first.sampleRate : null;
}

/** Returns the media duration in seconds, or null when the format is unknown/corrupt. */
export function probeAudioDuration(filePath) {
  let buf;
  try {
    buf = fs.readFileSync(filePath);
  } catch {
    return null;
  }
  const lower = String(filePath).toLowerCase();
  if (lower.endsWith(".wav")) return probeWavDuration(buf);
  if (lower.endsWith(".mp3")) return probeMp3Duration(buf);
  return probeWavDuration(buf) ?? probeMp3Duration(buf);
}
