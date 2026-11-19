// Pure-JS Audio DSP & ITU-R BS.1770-4 Loudness Normalization (Zero External Dependencies).
// Safe for both Node.js ESM and Browser WebAudio/WebCodecs workers.

function buildKWeightingCoeffs(sampleRate = 48000) {
  const sr = Math.max(8000, Number(sampleRate) || 48000);
  if (Math.round(sr) === 48000) {
    return {
      pre: {
        b0: 1.53512485958697,
        b1: -2.69169618940638,
        b2: 1.19839281085285,
        a1: -1.69065929318241,
        a2: 0.73248077421585,
      },
      rlb: {
        b0: 1.0,
        b1: -2.0,
        b2: 1.0,
        a1: -1.99004745483398,
        a2: 0.99007225036621,
      },
    };
  }

  // Stage 1: high-shelf pre-filter (+4 dB @ ~1.682 kHz) via bilinear transform
  const f0Pre = 1681.974450955533;
  const gDb = 3.999843853973347;
  const qPre = 0.7071752369554196;
  const kPre = Math.tan((Math.PI * f0Pre) / sr);
  const vh = Math.pow(10, gDb / 20);
  const vb = Math.pow(vh, 0.4996667741545416);
  const a0Pre = 1 + kPre / qPre + kPre * kPre;
  const pre = {
    b0: (vh + (vb * kPre) / qPre + kPre * kPre) / a0Pre,
    b1: (2 * (kPre * kPre - vh)) / a0Pre,
    b2: (vh - (vb * kPre) / qPre + kPre * kPre) / a0Pre,
    a1: (2 * (kPre * kPre - 1)) / a0Pre,
    a2: (1 - kPre / qPre + kPre * kPre) / a0Pre,
  };

  // Stage 2: RLB 2nd-order Butterworth high-pass (~38.135 Hz)
  const f0Rlb = 38.13547087602444;
  const qRlb = 0.5003270373238773;
  const kRlb = Math.tan((Math.PI * f0Rlb) / sr);
  const a0Rlb = 1 + kRlb / qRlb + kRlb * kRlb;
  const rlb = {
    b0: 1 / a0Rlb,
    b1: -2 / a0Rlb,
    b2: 1 / a0Rlb,
    a1: (2 * (kRlb * kRlb - 1)) / a0Rlb,
    a2: (1 - kRlb / qRlb + kRlb * kRlb) / a0Rlb,
  };

  return { pre, rlb };
}

function runBiquad(input, c, out) {
  let z1 = 0;
  let z2 = 0;
  const { b0, b1, b2, a1, a2 } = c;
  for (let i = 0; i < input.length; i++) {
    const x = input[i];
    const y = b0 * x + z1;
    z1 = b1 * x - a1 * y + z2;
    z2 = b2 * x - a2 * y;
    out[i] = y;
  }
  return out;
}

export function applyKWeighting(samples, sampleRate = 48000) {
  const n = samples?.length || 0;
  if (!n) return new Float32Array(0);
  const { pre, rlb } = buildKWeightingCoeffs(sampleRate);
  const stage1 = new Float32Array(n);
  const stage2 = new Float32Array(n);
  runBiquad(samples, pre, stage1);
  runBiquad(stage1, rlb, stage2);
  return stage2;
}

/**
 * Measure integrated loudness (ITU-R BS.1770-4 gated LUFS), unweighted RMS, and sample peak.
 */
export function measureIntegratedLufs(left, right = null, sampleRate = 48000) {
  const n = left?.length || 0;
  if (!n) return { lufs: -Infinity, rms: 0, peak: 0 };
  const rArr = right && right.length === n ? right : left;

  let sumSqRaw = 0;
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const lv = left[i];
    const rv = rArr[i];
    const al = lv < 0 ? -lv : lv;
    const ar = rv < 0 ? -rv : rv;
    if (al > peak) peak = al;
    if (ar > peak) peak = ar;
    sumSqRaw += 0.5 * (lv * lv + rv * rv);
  }
  const rms = Math.sqrt(sumSqRaw / n);

  const kL = applyKWeighting(left, sampleRate);
  const kR = rArr === left ? kL : applyKWeighting(rArr, sampleRate);

  const blockSamples = Math.max(1, Math.round(0.4 * sampleRate));
  const hopSamples = Math.max(1, Math.round(0.1 * sampleRate));

  const blockPowers = [];
  if (n < blockSamples) {
    let acc = 0;
    for (let i = 0; i < n; i++) {
      acc += kL[i] * kL[i] + (rArr === left ? kL[i] * kL[i] : kR[i] * kR[i]);
    }
    blockPowers.push(acc / n);
  } else {
    // Prefix sums for O(N) block energy calculation
    const pref = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) {
      const e = kL[i] * kL[i] + (rArr === left ? kL[i] * kL[i] : kR[i] * kR[i]);
      pref[i + 1] = pref[i] + e;
    }
    for (let start = 0; start + blockSamples <= n; start += hopSamples) {
      const power = (pref[start + blockSamples] - pref[start]) / blockSamples;
      blockPowers.push(power);
    }
  }

  // Absolute gate (-70 LUFS)
  const absGateLinear = Math.pow(10, (-70 + 0.691) / 10);
  const absPassed = [];
  let absSum = 0;
  for (let i = 0; i < blockPowers.length; i++) {
    const p = blockPowers[i];
    if (p > absGateLinear) {
      absPassed.push(p);
      absSum += p;
    }
  }
  if (!absPassed.length) {
    return { lufs: -Infinity, rms, peak };
  }

  // Relative gate (-10 LU below ungated absolute-passed average)
  const absMean = absSum / absPassed.length;
  const relThreshold = absMean * Math.pow(10, -10 / 10);
  let relSum = 0;
  let relCount = 0;
  for (let i = 0; i < absPassed.length; i++) {
    if (absPassed[i] > relThreshold) {
      relSum += absPassed[i];
      relCount += 1;
    }
  }
  const finalPower = relCount > 0 ? relSum / relCount : absMean;
  const lufs = finalPower > 0 ? -0.691 + 10 * Math.log10(finalPower) : -Infinity;
  return { lufs, rms, peak };
}

function applySoftLimiter(left, right, ceilingLinear) {
  const ceil = Math.max(0.1, Math.min(0.995, ceilingLinear));
  const knee = ceil * 0.88;
  const headroom = ceil - knee;
  const limitSample = (x) => {
    const ax = x < 0 ? -x : x;
    if (ax <= knee) return x;
    const excess = (ax - knee) / headroom;
    const limited = knee + headroom * Math.tanh(excess);
    return x < 0 ? -limited : limited;
  };
  let peak = 0;
  for (let i = 0; i < left.length; i++) {
    const lv = limitSample(left[i]);
    const rv = right && right !== left ? limitSample(right[i]) : lv;
    left[i] = lv;
    if (right && right !== left) right[i] = rv;
    const al = lv < 0 ? -lv : lv;
    const ar = rv < 0 ? -rv : rv;
    if (al > peak) peak = al;
    if (ar > peak) peak = ar;
  }
  return peak;
}

/**
 * Normalize stereo buffers in-place toward `targetLufs` (default -16 LUFS) with soft true-peak limiting.
 */
export function normalizeLoudnessAndLimit(
  left,
  right = null,
  {
    sampleRate = 48000,
    targetLufs = -16,
    maxGainDb = 18,
    minGainDb = -18,
    ceilingLinear = 0.8414, // -1.5 dBTP
  } = {}
) {
  const initial = measureIntegratedLufs(left, right, sampleRate);
  if (!Number.isFinite(initial.lufs) || initial.lufs <= -70) {
    const peak = applySoftLimiter(left, right, ceilingLinear);
    return {
      inputLufs: initial.lufs,
      outputLufs: initial.lufs,
      gainDb: 0,
      peak,
    };
  }

  let totalGainDb = 0;
  for (let pass = 0; pass < 2; pass++) {
    const cur = pass === 0 ? initial : measureIntegratedLufs(left, right, sampleRate);
    if (!Number.isFinite(cur.lufs)) break;
    const neededDb = targetLufs - cur.lufs;
    if (pass === 1 && Math.abs(neededDb) < 0.25) break;
    const clampedDb = Math.max(minGainDb, Math.min(maxGainDb, neededDb));
    const lin = Math.pow(10, clampedDb / 20);
    if (Math.abs(lin - 1) > 1e-4) {
      for (let i = 0; i < left.length; i++) {
        left[i] *= lin;
        if (right && right !== left) right[i] *= lin;
      }
      totalGainDb += clampedDb;
    }
    applySoftLimiter(left, right, ceilingLinear);
  }

  const finalStats = measureIntegratedLufs(left, right, sampleRate);
  return {
    inputLufs: Number(initial.lufs.toFixed(2)),
    outputLufs: Number(finalStats.lufs.toFixed(2)),
    gainDb: Number(totalGainDb.toFixed(2)),
    peak: Number(finalStats.peak.toFixed(4)),
  };
}
