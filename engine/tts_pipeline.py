#!/usr/bin/env python3
"""Pure-Python pluggable TTS & timing pipeline for Tech Course Video Studio.

Uses ONLY Python standard library (Windows WDAC safe; zero external binaries or pip packages).

Supports providers:
  - edge: Microsoft Edge ReadAloud neural voices via pure-stdlib TLS WebSocket (rate & pitch SSML)
  - voicestudio: Local OpenAI-compatible VoiceStudio API (http://localhost:8000/v1/audio/speech)
  - openai_compat: Generic OpenAI /v1/audio/speech adapter with optional env Bearer token
  - custom_http: Declarative HTTP JSON/binary adapter via payload_template + headers_env + audio_json_field
  - google: Chunked Google Translate TTS
  - auto: Tries configured profile / edge first, falls back to google ONLY when provider == "auto"
"""

import argparse
import base64
import copy
import hashlib
import io
import json
import math
import os
import re
import shutil
import socket
import ssl
import struct
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import uuid
import wave
from pathlib import Path
from typing import Any

TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4"
CHROMIUM_FULL_VERSION = "130.0.2849.68"
SEC_MS_GEC_VERSION = f"1-{CHROMIUM_FULL_VERSION}"

DEFAULT_VOICES_PATH = Path(__file__).resolve().parent / "voices.json"

BUILTIN_VOICES_CONFIG: dict[str, Any] = {
    "default_profile": "edge-hoaimy",
    "voicestudio_base_url": "http://localhost:8000",
    "profiles": [
        {
            "id": "edge-hoaimy",
            "label": "Hoài My (Nữ · Chuẩn truyền cảm)",
            "provider": "edge",
            "voice_id": "vi-VN-HoaiMyNeural",
            "rate": "+6%",
            "pitch": "+0Hz",
            "language": "vi",
            "gender": "female",
            "response_format": "mp3",
            "sample_text": "Xin chào, hôm nay chúng ta sẽ cùng khám phá kiến trúc hệ thống thực chiến.",
            "notes": "Mặc định rõ ràng, hợp tutorial công nghệ",
        }
    ],
}

# MPEG Layer III lookup tables
_BITRATES_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0]
_BITRATES_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0]
_SAMPLERATES = {
    3: [44100, 48000, 32000],  # MPEG 1
    2: [22050, 24000, 16000],  # MPEG 2
    0: [11025, 12000, 8000],   # MPEG 2.5
}

_EDGE_BLOCKED = False


def load_voices_config(voices_path: Path | None = None) -> dict[str, Any]:
    path = voices_path or DEFAULT_VOICES_PATH
    if not path.exists():
        return json.loads(json.dumps(BUILTIN_VOICES_CONFIG))
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return json.loads(json.dumps(BUILTIN_VOICES_CONFIG))
        data.setdefault("default_profile", "edge-hoaimy")
        data.setdefault("voicestudio_base_url", "http://localhost:8000")
        if not isinstance(data.get("profiles"), list):
            data["profiles"] = BUILTIN_VOICES_CONFIG["profiles"]
        return data
    except Exception:
        return json.loads(json.dumps(BUILTIN_VOICES_CONFIG))


def _auto_detect_course_path(script_path: Path) -> Path | None:
    """Check ../../course.json relative to script.json (and ../course.json fallback)."""
    candidates = [
        (script_path.parent / ".." / ".." / "course.json").resolve(),
        (script_path.parent / ".." / "course.json").resolve(),
    ]
    for candidate in candidates:
        if candidate.exists() and candidate.is_file():
            return candidate
    return None


def _normalize_edge_rate(rate: str | float | int | None) -> str:
    if rate is None or str(rate).strip() == "":
        return "+6%"
    s = str(rate).strip()
    if re.fullmatch(r"[+-]?\d+(?:\.\d+)?%", s):
        return s if s[0] in "+-" else f"+{s}"
    try:
        val = float(s)
        pct = int(round((val - 1.0) * 100))
        return f"{pct:+d}%"
    except ValueError:
        return "+0%"


def _normalize_edge_pitch(pitch: str | float | int | None) -> str:
    if pitch is None or str(pitch).strip() == "":
        return "+0Hz"
    s = str(pitch).strip()
    m = re.fullmatch(r"([+-]?\d+(?:\.\d+)?)hz", s, flags=re.IGNORECASE)
    if m:
        num = m.group(1)
        if num[0] not in "+-":
            num = f"+{num}"
        return f"{num}Hz"
    return "+0Hz"


def _rate_to_speed_float(rate: str | float | int | None) -> float:
    if rate is None or str(rate).strip() == "":
        return 1.0
    s = str(rate).strip()
    try:
        if s.endswith("%"):
            val = 1.0 + float(s[:-1]) / 100.0
        else:
            val = float(s)
        return max(0.25, min(4.0, round(val, 3)))
    except ValueError:
        return 1.0


def _normalize_xml_lang(lang: str | None) -> str:
    if not lang:
        return "vi-VN"
    s = lang.strip()
    if "-" in s:
        return s
    mapping = {"vi": "vi-VN", "en": "en-US", "ja": "ja-JP", "ko": "ko-KR", "zh": "zh-CN"}
    return mapping.get(s.lower(), f"{s}-{s.upper()}")


def resolve_voice_config(
    voices_cfg: dict[str, Any],
    script_data: dict[str, Any] | None = None,
    course_data: dict[str, Any] | None = None,
    cli_profile: str | None = None,
    cli_provider: str | None = None,
    cli_voice: str | None = None,
    cli_rate: str | None = None,
    cli_pitch: str | None = None,
) -> dict[str, Any]:
    """Resolve effective TTS configuration following hierarchy:

    CLI (--profile / --provider + --voice + --rate + --pitch)
      > script.json (tts_profile / tts_provider / tts_voice / tts_rate / tts_pitch)
      > course.json (tts_profile / tts_provider / tts_voice / tts_rate / tts_pitch)
      > voices.json default_profile
    """
    profiles_list = [p for p in voices_cfg.get("profiles", []) if isinstance(p, dict) and p.get("id")]
    profiles_by_id = {p["id"]: p for p in profiles_list}

    default_pid = voices_cfg.get("default_profile")
    if default_pid and default_pid in profiles_by_id:
        resolved = dict(profiles_by_id[default_pid])
        resolved_profile_id: str | None = default_pid
    elif profiles_list:
        resolved = dict(profiles_list[0])
        resolved_profile_id = resolved["id"]
    else:
        resolved = {
            "id": "edge-hoaimy",
            "provider": "edge",
            "voice_id": "vi-VN-HoaiMyNeural",
            "rate": "+6%",
            "pitch": "+0Hz",
            "language": "vi",
            "response_format": "mp3",
        }
        resolved_profile_id = "edge-hoaimy"

    def _apply_tier(tier_data: dict[str, Any] | None) -> None:
        nonlocal resolved, resolved_profile_id
        if not isinstance(tier_data, dict):
            return
        tier_pid = tier_data.get("tts_profile")
        if tier_pid:
            if tier_pid in profiles_by_id:
                resolved = dict(profiles_by_id[tier_pid])
                resolved_profile_id = tier_pid
            else:
                # Keep custom profile id reference if profile was removed later
                resolved_profile_id = tier_pid
        if tier_data.get("tts_provider"):
            new_prov = str(tier_data["tts_provider"]).strip()
            if new_prov != resolved.get("provider") and not tier_pid:
                match = next((p for p in profiles_list if p.get("provider") == new_prov), None)
                if match:
                    resolved = dict(match)
                    resolved_profile_id = match["id"]
                else:
                    resolved["provider"] = new_prov
                    resolved_profile_id = None
            else:
                resolved["provider"] = new_prov
        if tier_data.get("tts_voice"):
            resolved["voice_id"] = str(tier_data["tts_voice"]).strip()
        if tier_data.get("tts_rate"):
            resolved["rate"] = str(tier_data["tts_rate"]).strip()
        if tier_data.get("tts_pitch"):
            resolved["pitch"] = str(tier_data["tts_pitch"]).strip()
        if tier_data.get("language") and not resolved.get("language"):
            resolved["language"] = str(tier_data["language"]).strip()

    # Tier 1: course.json
    _apply_tier(course_data)
    # Tier 2: script.json
    _apply_tier(script_data)

    # Tier 3: CLI
    allow_auto_fallback = False
    if cli_profile:
        if cli_profile not in profiles_by_id:
            avail = ", ".join(sorted(profiles_by_id.keys()))
            raise ValueError(f"Unknown TTS profile '{cli_profile}'. Available profiles: {avail}")
        resolved = dict(profiles_by_id[cli_profile])
        resolved_profile_id = cli_profile

    if cli_provider:
        if cli_provider == "auto":
            allow_auto_fallback = True
        else:
            if not cli_profile and cli_provider != resolved.get("provider"):
                match = next((p for p in profiles_list if p.get("provider") == cli_provider), None)
                if match:
                    resolved = dict(match)
                    resolved_profile_id = match["id"]
                else:
                    resolved = {
                        "id": "",
                        "provider": cli_provider,
                        "voice_id": "vi" if cli_provider == "google" else "default",
                        "rate": "+0%",
                        "pitch": "+0Hz",
                        "language": resolved.get("language") or "vi",
                        "response_format": "mp3",
                    }
                    resolved_profile_id = None
            resolved["provider"] = cli_provider

    if cli_voice:
        resolved["voice_id"] = cli_voice.strip()
    if cli_rate:
        resolved["rate"] = cli_rate.strip()
    if cli_pitch:
        resolved["pitch"] = cli_pitch.strip()

    if resolved.get("provider") == "auto":
        allow_auto_fallback = True
        resolved["provider"] = "edge"

    resolved["resolved_profile_id"] = resolved_profile_id
    resolved["allow_auto_fallback"] = allow_auto_fallback
    resolved["voicestudio_base_url"] = voices_cfg.get("voicestudio_base_url", "http://localhost:8000")
    return resolved


# ---------------------------------------------------------------------------
# Audio detection, MP3 frame parser & WAV PCM parser/merger
# ---------------------------------------------------------------------------

def detect_audio_format(data: bytes, hint: str | None = None) -> str:
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WAVE":
        return "wav"
    if len(data) >= 3 and data[:3] == b"ID3":
        return "mp3"
    if len(data) >= 2 and data[0] == 0xFF and (data[1] & 0xE0) == 0xE0:
        return "mp3"
    if hint and hint.lower() in ("mp3", "wav"):
        return hint.lower()
    return "mp3"


def strip_mp3_tags_and_measure(mp3_bytes: bytes) -> tuple[bytes, float]:
    """Extract clean MPEG audio frames and compute exact playback duration in seconds."""
    if not mp3_bytes:
        return b"", 0.0

    data = mp3_bytes
    pos = 0
    length = len(data)

    # Skip leading ID3v2 header if present
    if length >= 10 and data[:3] == b"ID3":
        tag_size = (
            ((data[6] & 0x7F) << 21)
            | ((data[7] & 0x7F) << 14)
            | ((data[8] & 0x7F) << 7)
            | (data[9] & 0x7F)
        )
        pos = min(10 + tag_size, length)

    # Strip trailing ID3v1 tag if present
    end_limit = length
    if end_limit - pos >= 128 and data[end_limit - 128:end_limit - 125] == b"TAG":
        end_limit -= 128

    clean_frames = bytearray()
    total_duration = 0.0
    first_frame_skipped_xing = False

    while pos + 4 <= end_limit:
        if data[pos] != 0xFF or (data[pos + 1] & 0xE0) != 0xE0:
            pos += 1
            continue

        b1, b2 = data[pos + 1], data[pos + 2]
        version_id = (b1 >> 3) & 0x03
        layer = (b1 >> 1) & 0x03
        bitrate_idx = (b2 >> 4) & 0x0F
        sr_idx = (b2 >> 2) & 0x03
        padding = (b2 >> 1) & 0x01

        if version_id == 1 or layer != 1 or bitrate_idx in (0, 15) or sr_idx == 3:
            pos += 1
            continue

        sr = _SAMPLERATES[version_id][sr_idx]
        if version_id == 3:  # MPEG 1 Layer III
            bitrate = _BITRATES_V1_L3[bitrate_idx] * 1000
            samples = 1152
            frame_len = (144 * bitrate) // sr + padding
        else:  # MPEG 2 / 2.5 Layer III
            bitrate = _BITRATES_V2_L3[bitrate_idx] * 1000
            samples = 576
            frame_len = (72 * bitrate) // sr + padding

        if frame_len < 4 or pos + frame_len > end_limit:
            pos += 1
            continue

        frame = data[pos:pos + frame_len]
        if not first_frame_skipped_xing and (b"Xing" in frame[:48] or b"Info" in frame[:48]):
            first_frame_skipped_xing = True
            pos += frame_len
            continue

        first_frame_skipped_xing = True
        clean_frames.extend(frame)
        total_duration += samples / float(sr)
        pos += frame_len

    if not clean_frames:
        est_sec = max(0.5, (len(mp3_bytes) * 8.0) / 32000.0)
        return mp3_bytes, est_sec

    return bytes(clean_frames), total_duration


def _parse_wav_chunk_fallback(wav_bytes: bytes) -> tuple[tuple[int, int, int], bytes, float]:
    """Fallback RIFF parser for streaming WAVs with placeholder 0xFFFFFFFF chunk lengths."""
    pos = 12
    nchannels, sampwidth, framerate = 1, 2, 24000
    pcm = b""
    length = len(wav_bytes)
    while pos + 8 <= length:
        chunk_id = wav_bytes[pos:pos + 4]
        chunk_size = struct.unpack("<I", wav_bytes[pos + 4:pos + 8])[0]
        data_start = pos + 8
        if chunk_id == b"fmt " and pos + 24 <= length:
            _, nchannels, framerate, _, _, bits_per_sample = struct.unpack(
                "<HHIIHH", wav_bytes[data_start:data_start + 16]
            )
            sampwidth = max(1, bits_per_sample // 8)
        elif chunk_id == b"data":
            if chunk_size == 0xFFFFFFFF or data_start + chunk_size > length:
                pcm = wav_bytes[data_start:]
                break
            pcm = wav_bytes[data_start:data_start + chunk_size]
        if chunk_size == 0xFFFFFFFF:
            break
        pos = data_start + chunk_size + (chunk_size & 1)
    denom = max(1, nchannels * sampwidth * framerate)
    dur = len(pcm) / float(denom)
    return (nchannels, sampwidth, framerate), pcm, dur


def parse_wav_and_measure(wav_bytes: bytes) -> tuple[tuple[int, int, int], bytes, float]:
    """Parse WAV bytes via pure stdlib wave + io.BytesIO and return ((ch, sw, sr), pcm_bytes, duration_sec)."""
    try:
        with wave.open(io.BytesIO(wav_bytes), "rb") as w:
            nchannels = w.getnchannels()
            sampwidth = w.getsampwidth()
            framerate = w.getframerate()
            nframes = w.getnframes()
            pcm = w.readframes(nframes)
        if not pcm or framerate <= 0:
            return _parse_wav_chunk_fallback(wav_bytes)
        bytes_per_frame = max(1, nchannels * sampwidth)
        actual_frames = len(pcm) // bytes_per_frame
        dur = actual_frames / float(framerate)
        return (nchannels, sampwidth, framerate), pcm, dur
    except (wave.Error, EOFError, struct.error):
        return _parse_wav_chunk_fallback(wav_bytes)


def build_wav_bytes(params: tuple[int, int, int], pcm_bytes: bytes) -> bytes:
    nchannels, sampwidth, framerate = params
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(nchannels)
        w.setsampwidth(sampwidth)
        w.setframerate(framerate)
        w.writeframes(pcm_bytes)
    return buf.getvalue()


def measure_audio_chunk(raw_bytes: bytes, hint: str | None = None) -> tuple[str, bytes, tuple[int, int, int] | None, float]:
    """Return (ext, payload_bytes_for_concat, wav_params_or_none, duration_sec)."""
    fmt = detect_audio_format(raw_bytes, hint=hint)
    if fmt == "wav":
        params, pcm, dur = parse_wav_and_measure(raw_bytes)
        return "wav", pcm, params, dur
    clean_mp3, dur = strip_mp3_tags_and_measure(raw_bytes)
    return "mp3", clean_mp3, None, dur


# ---------------------------------------------------------------------------
# Text chunking
# ---------------------------------------------------------------------------

def split_text_for_tts(text: str, max_chars: int = 165) -> list[str]:
    """Split Vietnamese + English narration into natural clauses under max_chars."""
    text = re.sub(r"\s+", " ", text).strip()
    if not text:
        return []

    raw_sentences = re.split(r"(?<=[.!?])\s+", text)
    chunks: list[str] = []

    for sent in raw_sentences:
        sent = sent.strip()
        if not sent:
            continue
        if len(sent) <= max_chars:
            chunks.append(sent)
            continue

        sub_parts = re.split(r"(?<=[,;:–—])\s+", sent)
        buf = ""
        for part in sub_parts:
            if len(buf) + len(part) + 1 <= max_chars:
                buf = f"{buf} {part}".strip()
            else:
                if buf:
                    chunks.append(buf)
                if len(part) <= max_chars:
                    buf = part
                else:
                    words = part.split(" ")
                    wbuf = ""
                    for w in words:
                        if len(wbuf) + len(w) + 1 <= max_chars:
                            wbuf = f"{wbuf} {w}".strip()
                        else:
                            if wbuf:
                                chunks.append(wbuf)
                            wbuf = w
                    buf = wbuf
        if buf:
            chunks.append(buf)

    return chunks


# ---------------------------------------------------------------------------
# Edge ReadAloud WebSocket client (pure stdlib)
# ---------------------------------------------------------------------------

def _compute_sec_ms_gec() -> str:
    ticks = int((time.time() + 11644473600) * 10000000)
    ticks -= ticks % 3000000000
    return hashlib.sha256(f"{ticks}{TRUSTED_CLIENT_TOKEN}".encode("ascii")).hexdigest().upper()


def _ws_send_text(sock: ssl.SSLSocket, payload: str) -> None:
    raw = payload.encode("utf-8")
    mask_key = os.urandom(4)
    header = bytearray([0x81])
    length = len(raw)
    if length < 126:
        header.append(0x80 | length)
    elif length < 65536:
        header.append(0x80 | 126)
        header.extend(struct.pack("!H", length))
    else:
        header.append(0x80 | 127)
        header.extend(struct.pack("!Q", length))
    header.extend(mask_key)
    masked = bytes(b ^ mask_key[i % 4] for i, b in enumerate(raw))
    sock.sendall(bytes(header) + masked)


def _recv_exact(sock: ssl.SSLSocket, n: int) -> bytes:
    buf = bytearray()
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            raise EOFError("WebSocket closed unexpectedly")
        buf.extend(chunk)
    return bytes(buf)


def _ws_recv_frame(sock: ssl.SSLSocket) -> tuple[int, bytes]:
    b1, b2 = _recv_exact(sock, 2)
    opcode = b1 & 0x0F
    masked = (b2 & 0x80) != 0
    length = b2 & 0x7F
    if length == 126:
        length = struct.unpack("!H", _recv_exact(sock, 2))[0]
    elif length == 127:
        length = struct.unpack("!Q", _recv_exact(sock, 8))[0]
    mask_key = _recv_exact(sock, 4) if masked else b""
    payload = _recv_exact(sock, length)
    if masked:
        payload = bytes(b ^ mask_key[i % 4] for i, b in enumerate(payload))
    return opcode, payload


def _xml_escape(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&apos;")
    )


def synthesize_edge(
    text: str,
    voice: str = "vi-VN-HoaiMyNeural",
    rate: str = "+6%",
    pitch: str = "+0Hz",
    lang: str = "vi-VN",
) -> bytes:
    """Synthesize speech using Microsoft Edge ReadAloud neural voices over pure TLS WebSocket."""
    edge_rate = _normalize_edge_rate(rate)
    edge_pitch = _normalize_edge_pitch(pitch)
    xml_lang = _normalize_xml_lang(lang)

    host = "speech.platform.bing.com"
    conn_id = uuid.uuid4().hex
    gec = _compute_sec_ms_gec()
    path = (
        f"/consumer/speech/synthesize/readaloud/edge/v1"
        f"?TrustedClientToken={TRUSTED_CLIENT_TOKEN}"
        f"&ConnectionId={conn_id}"
        f"&Sec-MS-GEC={gec}"
        f"&Sec-MS-GEC-Version={SEC_MS_GEC_VERSION}"
    )

    ws_key = base64.b64encode(os.urandom(16)).decode("ascii")
    ctx = ssl.create_default_context()
    raw_sock = socket.create_connection((host, 443), timeout=12)
    sock = ctx.wrap_socket(raw_sock, server_hostname=host)
    sock.settimeout(15)

    try:
        handshake = (
            f"GET {path} HTTP/1.1\r\n"
            f"Host: {host}\r\n"
            f"Upgrade: websocket\r\n"
            f"Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {ws_key}\r\n"
            f"Sec-WebSocket-Version: 13\r\n"
            f"Origin: chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold\r\n"
            f"User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            f"(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0\r\n\r\n"
        )
        sock.sendall(handshake.encode("ascii"))

        resp_buf = b""
        while b"\r\n\r\n" not in resp_buf:
            chunk = sock.recv(4096)
            if not chunk:
                raise ConnectionError("Empty WebSocket handshake response")
            resp_buf += chunk
        status_line = resp_buf.split(b"\r\n", 1)[0].decode("latin1")
        if "101" not in status_line:
            raise ConnectionError(f"Edge WS handshake failed: {status_line}")

        ts = time.strftime("%a %b %d %Y %H:%M:%S GMT+0000 (Coordinated Universal Time)", time.gmtime())
        config_msg = (
            f"X-Timestamp:{ts}\r\n"
            f"Content-Type:application/json; charset=utf-8\r\n"
            f"Path:speech.config\r\n\r\n"
            + json.dumps({
                "context": {
                    "synthesis": {
                        "audio": {
                            "metadataoptions": {
                                "sentenceBoundaryEnabled": "false",
                                "wordBoundaryEnabled": "false",
                            },
                            "outputFormat": "audio-24khz-48kbitrate-mono-mp3",
                        }
                    }
                }
            })
        )
        _ws_send_text(sock, config_msg)

        req_id = uuid.uuid4().hex
        ssml = (
            f"<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='{xml_lang}'>"
            f"<voice name='{_xml_escape(voice)}'>"
            f"<prosody pitch='{edge_pitch}' rate='{edge_rate}' volume='+0%'>"
            f"{_xml_escape(text)}</prosody></voice></speak>"
        )
        ssml_msg = (
            f"X-RequestId:{req_id}\r\n"
            f"Content-Type:application/ssml+xml\r\n"
            f"X-Timestamp:{ts}Z\r\n"
            f"Path:ssml\r\n\r\n"
            f"{ssml}"
        )
        _ws_send_text(sock, ssml_msg)

        audio_data = bytearray()
        while True:
            opcode, payload = _ws_recv_frame(sock)
            if opcode == 8:
                break
            if opcode == 9:
                continue
            if opcode == 1:
                header_text = payload.decode("utf-8", errors="ignore")
                if "Path:turn.end" in header_text:
                    break
            elif opcode == 2:
                if len(payload) < 2:
                    continue
                header_len = struct.unpack("!H", payload[:2])[0]
                if 2 + header_len <= len(payload):
                    audio_data.extend(payload[2 + header_len:])

        if not audio_data:
            raise RuntimeError(
                f"Edge TTS returned zero audio bytes for voice '{voice}' (rate={edge_rate}, pitch={edge_pitch})."
            )
        return bytes(audio_data)
    finally:
        try:
            sock.close()
        except OSError:
            pass


# ---------------------------------------------------------------------------
# Google & HTTP-based TTS providers
# ---------------------------------------------------------------------------

def synthesize_google(text: str, lang: str = "vi") -> bytes:
    """Synthesize speech using Google Translate TTS endpoint."""
    tl = (lang or "vi").split("-")[0].lower()
    query = urllib.parse.quote(text)
    url = f"https://translate.googleapis.com/translate_tts?ie=UTF-8&client=tw-ob&tl={tl}&q={query}"
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Referer": "https://translate.google.com/",
        },
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        data = resp.read()
    if not data:
        raise RuntimeError("Google TTS returned empty response")
    return data


def _build_http_headers(profile: dict[str, Any]) -> dict[str, str]:
    headers: dict[str, str] = {"Content-Type": "application/json"}
    extra_headers = profile.get("headers")
    if isinstance(extra_headers, dict):
        for k, v in extra_headers.items():
            val_str = str(v)
            val_str = re.sub(
                r"\{\{env:([A-Za-z0-9_]+)\}\}",
                lambda m: os.environ.get(m.group(1), ""),
                val_str,
            )
            headers[str(k)] = val_str

    headers_env = profile.get("headers_env")
    if headers_env:
        env_val = os.environ.get(str(headers_env), "").strip()
        if not env_val:
            raise RuntimeError(
                f"Environment variable '{headers_env}' is not set or empty "
                f"(required by TTS profile '{profile.get('id') or profile.get('provider')}')."
            )
        if env_val.startswith("{"):
            try:
                parsed = json.loads(env_val)
                if isinstance(parsed, dict):
                    for k, v in parsed.items():
                        headers[str(k)] = str(v)
            except json.JSONDecodeError as exc:
                raise RuntimeError(f"Invalid JSON in env var '{headers_env}': {exc}") from exc
        elif env_val.lower().startswith("bearer "):
            headers["Authorization"] = env_val
        else:
            headers["Authorization"] = f"Bearer {env_val}"
    return headers


def _extract_json_field(obj: Any, field_path: str) -> Any:
    cur = obj
    for part in field_path.split("."):
        if isinstance(cur, dict) and part in cur:
            cur = cur[part]
        elif isinstance(cur, list) and part.isdigit() and 0 <= int(part) < len(cur):
            cur = cur[int(part)]
        else:
            raise KeyError(f"Field '{field_path}' not found in JSON response")
    return cur


def _decode_http_audio_response(raw_body: bytes, profile: dict[str, Any]) -> bytes:
    json_field = profile.get("audio_json_field")
    if json_field:
        try:
            payload = json.loads(raw_body.decode("utf-8"))
        except Exception as exc:
            raise RuntimeError(f"Expected JSON response containing '{json_field}', got non-JSON: {exc}") from exc
        b64_val = _extract_json_field(payload, str(json_field))
        if not isinstance(b64_val, str) or not b64_val.strip():
            raise RuntimeError(f"JSON audio field '{json_field}' is empty or not a base64 string")
        cleaned = re.sub(r"^data:audio/[^;]+;base64,", "", b64_val.strip(), flags=re.IGNORECASE)
        return base64.b64decode(cleaned)
    return raw_body


def _render_template(node: Any, vars_map: dict[str, Any]) -> Any:
    if isinstance(node, dict):
        return {k: _render_template(v, vars_map) for k, v in node.items()}
    if isinstance(node, list):
        return [_render_template(item, vars_map) for item in node]
    if isinstance(node, str):
        if node == "{{speed}}":
            return vars_map["speed"]
        out = node
        for key, val in vars_map.items():
            out = out.replace(f"{{{{{key}}}}}", str(val))
        return out
    return node


def synthesize_voicestudio(text: str, profile: dict[str, Any]) -> bytes:
    """Synthesize speech via VoiceStudio OpenAI-compatible HTTP endpoint."""
    base_url = str(profile.get("voicestudio_base_url") or "http://localhost:8000").rstrip("/")
    endpoint = (
        profile.get("endpoint")
        or os.environ.get("VOICESTUDIO_API_URL")
        or f"{base_url}/v1/audio/speech"
    )
    voice_id = profile.get("voice_id") or "default"
    fmt = profile.get("response_format") or "mp3"
    speed = _rate_to_speed_float(profile.get("rate"))

    payload: dict[str, Any] = {
        "model": profile.get("model") or "tts-1",
        "input": text,
        "voice": voice_id,
        "response_format": fmt,
        "speed": speed,
    }
    headers = _build_http_headers(profile)
    req = urllib.request.Request(
        endpoint,
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read()
    except urllib.error.HTTPError as exc:
        err_body = exc.read().decode("utf-8", errors="ignore")[:300]
        raise RuntimeError(
            f"VoiceStudio HTTP {exc.code} at {endpoint} (voice='{voice_id}'): {err_body or exc.reason}"
        ) from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(
            f"Cannot connect to VoiceStudio at {endpoint}: {exc.reason}. "
            f"Start VoiceStudio locally or update endpoint/profile."
        ) from exc

    data = _decode_http_audio_response(raw, profile)
    if not data:
        raise RuntimeError(f"VoiceStudio returned empty audio bytes from {endpoint}")
    return data


def synthesize_openai_compat(text: str, profile: dict[str, Any]) -> bytes:
    """Synthesize speech via generic OpenAI-compatible /v1/audio/speech endpoint."""
    endpoint = profile.get("endpoint") or "https://api.openai.com/v1/audio/speech"
    voice_id = profile.get("voice_id") or "alloy"
    fmt = profile.get("response_format") or "mp3"
    speed = _rate_to_speed_float(profile.get("rate"))

    payload: dict[str, Any] = {
        "model": profile.get("model") or "tts-1",
        "input": text,
        "voice": voice_id,
        "response_format": fmt,
        "speed": speed,
    }
    headers = _build_http_headers(profile)
    req = urllib.request.Request(
        endpoint,
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method=(profile.get("method") or "POST").upper(),
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read()
    except urllib.error.HTTPError as exc:
        err_body = exc.read().decode("utf-8", errors="ignore")[:300]
        raise RuntimeError(
            f"OpenAI-compatible TTS HTTP {exc.code} at {endpoint}: {err_body or exc.reason}"
        ) from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Cannot reach OpenAI-compatible endpoint {endpoint}: {exc.reason}") from exc

    data = _decode_http_audio_response(raw, profile)
    if not data:
        raise RuntimeError(f"OpenAI-compatible endpoint returned empty audio bytes from {endpoint}")
    return data


def synthesize_custom_http(text: str, profile: dict[str, Any]) -> bytes:
    """Declarative HTTP TTS adapter driven by payload_template, headers_env, and optional audio_json_field."""
    endpoint_tpl = profile.get("endpoint")
    if not endpoint_tpl:
        raise ValueError(f"Profile '{profile.get('id')}' (custom_http) requires an 'endpoint' URL.")

    voice_id = str(profile.get("voice_id") or "default")
    rate = str(profile.get("rate") or "1.0")
    pitch = str(profile.get("pitch") or "+0Hz")
    language = str(profile.get("language") or "vi")
    response_format = str(profile.get("response_format") or "mp3")
    speed = _rate_to_speed_float(rate)

    vars_map: dict[str, Any] = {
        "text": text,
        "voice_id": voice_id,
        "rate": rate,
        "pitch": pitch,
        "language": language,
        "response_format": response_format,
        "speed": speed,
    }

    endpoint = str(endpoint_tpl)
    for key, val in vars_map.items():
        endpoint = endpoint.replace(f"{{{{{key}}}}}", urllib.parse.quote(str(val), safe=""))

    method = str(profile.get("method") or "POST").upper()
    headers = _build_http_headers(profile)

    tpl = profile.get("payload_template")
    if tpl is not None:
        rendered = _render_template(tpl, vars_map)
        body_bytes: bytes | None = (
            rendered.encode("utf-8")
            if isinstance(rendered, str)
            else json.dumps(rendered, ensure_ascii=False).encode("utf-8")
        )
    elif method in ("POST", "PUT", "PATCH"):
        body_bytes = json.dumps(
            {
                "text": text,
                "voice_id": voice_id,
                "rate": rate,
                "pitch": pitch,
                "language": language,
                "response_format": response_format,
            },
            ensure_ascii=False,
        ).encode("utf-8")
    else:
        body_bytes = None

    req = urllib.request.Request(endpoint, data=body_bytes, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read()
    except urllib.error.HTTPError as exc:
        err_body = exc.read().decode("utf-8", errors="ignore")[:300]
        raise RuntimeError(
            f"Custom HTTP TTS error {exc.code} at {endpoint}: {err_body or exc.reason}"
        ) from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Cannot reach custom HTTP TTS endpoint {endpoint}: {exc.reason}") from exc

    data = _decode_http_audio_response(raw, profile)
    if not data:
        raise RuntimeError(f"Custom HTTP TTS returned empty audio from {endpoint}")
    return data


def synthesize_chunk(text: str, config: dict[str, Any]) -> tuple[bytes, str]:
    """Synthesize a single text chunk using resolved config.

    Returns (raw_audio_bytes, actual_provider_used).
    NEVER silently falls back to Google unless config['allow_auto_fallback'] is True.
    """
    global _EDGE_BLOCKED
    provider = config.get("provider", "edge")
    voice_id = config.get("voice_id") or "vi-VN-HoaiMyNeural"
    rate = config.get("rate") or "+6%"
    pitch = config.get("pitch") or "+0Hz"
    lang = config.get("language") or "vi"
    allow_auto = bool(config.get("allow_auto_fallback"))

    def _run_primary() -> tuple[bytes, str]:
        if provider == "voicestudio":
            return synthesize_voicestudio(text, config), "voicestudio"
        if provider == "openai_compat":
            return synthesize_openai_compat(text, config), "openai_compat"
        if provider == "custom_http":
            return synthesize_custom_http(text, config), "custom_http"
        if provider == "google":
            return synthesize_google(text, lang), "google"
        if provider == "edge":
            return synthesize_edge(text, voice=voice_id, rate=rate, pitch=pitch, lang=lang), "edge"
        raise ValueError(f"Unsupported TTS provider: '{provider}'")

    if not allow_auto:
        return _run_primary()

    # Auto mode ONLY: try primary (skipping Edge if already known blocked in this run), else Google
    if provider == "edge" and _EDGE_BLOCKED:
        return synthesize_google(text, lang), "google"
    try:
        return _run_primary()
    except Exception:
        if provider == "edge":
            _EDGE_BLOCKED = True
        return synthesize_google(text, lang), "google"


# ---------------------------------------------------------------------------
# VoiceStudio Discovery
# ---------------------------------------------------------------------------

def _normalize_discovered_voices(payload: Any, endpoint: str) -> list[dict[str, Any]]:
    raw_items: list[Any] = []
    if isinstance(payload, list):
        raw_items = payload
    elif isinstance(payload, dict):
        for key in ("voices", "data", "items", "models"):
            if isinstance(payload.get(key), list):
                raw_items = payload[key]
                break
    voices: list[dict[str, Any]] = []
    for item in raw_items:
        if isinstance(item, str):
            voices.append({"id": item, "label": item, "source": endpoint})
        elif isinstance(item, dict):
            vid = item.get("id") or item.get("voice_id") or item.get("name")
            if not vid:
                continue
            voices.append({
                "id": str(vid),
                "label": str(item.get("label") or item.get("name") or vid),
                "language": item.get("language") or item.get("lang") or "",
                "source": endpoint,
            })
    return voices


def discover_voicestudio(base_url: str, timeout: float = 1.5) -> dict[str, Any]:
    """Probe /v1/audio/voices and /voices on voicestudio_base_url without failing if offline."""
    clean_base = (base_url or "http://localhost:8000").rstrip("/")
    reachable = False
    voices: list[dict[str, Any]] = []
    seen_ids: set[str] = set()

    for path in ("/v1/audio/voices", "/voices"):
        url = f"{clean_base}{path}"
        req = urllib.request.Request(url, headers={"Accept": "application/json"}, method="GET")
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                reachable = True
                raw = resp.read().decode("utf-8", errors="ignore")
                try:
                    parsed = json.loads(raw)
                except json.JSONDecodeError:
                    parsed = None
                if parsed is not None:
                    for v in _normalize_discovered_voices(parsed, path):
                        if v["id"] not in seen_ids:
                            seen_ids.add(v["id"])
                            voices.append(v)
        except urllib.error.HTTPError as exc:
            # Server responded (reachable), even if this specific path returned 404/405
            if exc.code < 500:
                reachable = True
        except Exception:
            continue

    return {
        "ok": True,
        "reachable": reachable,
        "base_url": clean_base,
        "voices": voices,
    }


# ---------------------------------------------------------------------------
# Episode & Preview Processing
# ---------------------------------------------------------------------------

def format_srt_time(seconds: float) -> str:
    ms_total = max(0, int(round(seconds * 1000)))
    hrs = ms_total // 3_600_000
    mins = (ms_total % 3_600_000) // 60_000
    secs = (ms_total % 60_000) // 1000
    ms = ms_total % 1000
    return f"{hrs:02d}:{mins:02d}:{secs:02d},{ms:03d}"


def synthesize_text_to_audio(text: str, config: dict[str, Any]) -> tuple[bytes, str, float, list[str]]:
    """Synthesize arbitrary-length text (splitting if needed) and return (final_bytes, ext, duration_sec, providers)."""
    max_chars = 165 if config.get("provider") == "google" or config.get("allow_auto_fallback") else 220
    chunks = split_text_for_tts(text, max_chars=max_chars)
    if not chunks:
        raise ValueError("Input text is empty")

    hint = config.get("response_format") or "mp3"
    providers_used: set[str] = set()
    mp3_buf = bytearray()
    wav_pcm_buf = bytearray()
    wav_params: tuple[int, int, int] | None = None
    total_dur = 0.0
    detected_ext: str | None = None

    for chunk in chunks:
        raw, used = synthesize_chunk(chunk, config)
        providers_used.add(used)
        ext, payload, params, dur = measure_audio_chunk(raw, hint=hint)
        if detected_ext is None:
            detected_ext = ext
        if ext == "wav":
            if wav_params is None:
                wav_params = params
            wav_pcm_buf.extend(payload)
        else:
            mp3_buf.extend(payload)
        total_dur += dur

    if detected_ext == "wav" and wav_params is not None:
        final_bytes = build_wav_bytes(wav_params, bytes(wav_pcm_buf))
        nch, sw, sr = wav_params
        exact_dur = len(wav_pcm_buf) / float(max(1, nch * sw * sr))
        return final_bytes, "wav", round(exact_dur, 3), sorted(providers_used)

    return bytes(mp3_buf), "mp3", round(total_dur, 3), sorted(providers_used)


def process_preview(
    voices_cfg: dict[str, Any],
    out_path: Path,
    text: str | None,
    cli_profile: str | None,
    cli_provider: str | None,
    cli_voice: str | None,
    cli_rate: str | None,
    cli_pitch: str | None,
) -> dict[str, Any]:
    config = resolve_voice_config(
        voices_cfg,
        cli_profile=cli_profile,
        cli_provider=cli_provider,
        cli_voice=cli_voice,
        cli_rate=cli_rate,
        cli_pitch=cli_pitch,
    )
    sample = (text or "").strip() or config.get("sample_text") or (
        "Xin chào, đây là giọng đọc thử nghiệm từ Tech Video Studio."
    )
    audio_bytes, ext, dur_sec, providers_used = synthesize_text_to_audio(sample, config)

    target = out_path if out_path.suffix.lower() in (".mp3", ".wav") else out_path.with_suffix(f".{ext}")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(audio_bytes)

    return {
        "ok": True,
        "out": str(target),
        "ext": ext,
        "duration_sec": dur_sec,
        "provider_used": providers_used[0] if len(providers_used) == 1 else providers_used,
        "voice_id": config.get("voice_id"),
        "profile_id": config.get("resolved_profile_id"),
    }


# ---------------------------------------------------------------------------
# Multi-Voice Profile Sanitization, Legacy Migration & Subtitle-Cue Alignment
# ---------------------------------------------------------------------------

_STOPWORDS = frozenset({
    "la", "cua", "va", "cho", "voi", "cac", "mot", "nhung", "trong", "khi",
    "nay", "do", "thi", "de", "ban", "ta", "chung", "minh", "nhu", "hay",
    "hoac", "neu", "ma", "bi", "duoc", "se", "da", "dang", "rat", "ngay",
    "o", "tai", "tu", "den", "len", "xuong", "ra", "vao", "ve", "sau", "truoc",
    "the", "and", "for", "with", "to", "in", "of", "a", "an", "is", "are",
    "on", "or", "by", "as", "at", "it", "be", "this", "that", "from", "into",
})


def sanitize_profile_id(
    raw_id: str | None,
    fallback_voice: str | None = None,
    fallback_provider: str | None = None,
) -> str:
    """Sanitize a TTS profile identifier to safe [a-zA-Z0-9_-] directory/filename characters."""
    candidate = str(raw_id or "").strip()
    if not candidate:
        prov = str(fallback_provider or "").strip()
        voice = str(fallback_voice or "").strip()
        if prov and voice:
            candidate = f"{prov}-{voice}"
        elif voice:
            candidate = voice
        elif prov:
            candidate = prov
        else:
            candidate = "default"
    cleaned = re.sub(r"[^a-zA-Z0-9_-]+", "-", candidate)
    cleaned = re.sub(r"-{2,}", "-", cleaned).strip("-_")
    if not cleaned:
        return "default"
    return cleaned[:80]


def _write_json_atomic(target: Path, payload: dict[str, Any]) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_name(f"{target.name}.tmp.{os.getpid()}")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, target)


def _clamp01(val: Any, fallback: float = 0.0) -> float:
    try:
        num = float(val)
        if not math.isfinite(num):
            return max(0.0, min(1.0, float(fallback)))
        return max(0.0, min(1.0, num))
    except (TypeError, ValueError):
        return max(0.0, min(1.0, float(fallback)))


def _round_p(val: float) -> float:
    return round(max(0.0, min(1.0, float(val))), 3)


def _fold_accents(text: str) -> str:
    s = str(text or "").replace("đ", "d").replace("Đ", "D")
    nfd = unicodedata.normalize("NFD", s)
    return "".join(ch for ch in nfd if unicodedata.category(ch) != "Mn")


def _normalize_for_substring(text: str) -> str:
    folded = _fold_accents(str(text or "")).lower()
    folded = re.sub(r"[^a-z0-9]+", " ", folded)
    return re.sub(r"\s+", " ", folded).strip()


def _tokenize_text(text: str) -> tuple[list[str], list[str]]:
    """Return (exact_tokens, folded_tokens) with punctuation split and stopwords filtered."""
    raw = str(text or "").lower()
    # Keep Vietnamese letters & digits; split punctuation like ':', '-', '_', '/'
    raw_cleaned = re.sub(r"[^\w\s]", " ", raw, flags=re.UNICODE).replace("_", " ")
    exact_tokens: list[str] = []
    folded_tokens: list[str] = []
    for tok in raw_cleaned.split():
        if not tok:
            continue
        ftok = _fold_accents(tok)
        if not ftok:
            continue
        if ftok in _STOPWORDS:
            continue
        if len(ftok) < 2 and not ftok.isdigit():
            continue
        exact_tokens.append(tok)
        folded_tokens.append(ftok)
    return exact_tokens, folded_tokens


def extract_scene_timings(scene: dict[str, Any]) -> dict[str, Any]:
    """Extract a normalized snapshot of step-timing fields from scene['visual_data']."""
    vdata = scene.get("visual_data")
    if not isinstance(vdata, dict):
        return {}

    timings: dict[str, Any] = {}

    def _extract_contiguous_list(key: str, default_start_offset: float = 0.0, default_span: float = 1.0) -> None:
        arr = vdata.get(key)
        if not isinstance(arr, list) or not arr:
            return
        count = len(arr)
        out: list[dict[str, Any]] = []
        for idx, item in enumerate(arr):
            if not isinstance(item, dict):
                continue
            fb_start = default_start_offset + (idx / max(1, count)) * default_span
            p_start = _clamp01(item.get("progress_start", item.get("progress_at")), fb_start)
            fb_end = (
                _clamp01(arr[idx + 1].get("progress_start", arr[idx + 1].get("progress_at")),
                         default_start_offset + ((idx + 1) / max(1, count)) * default_span)
                if idx + 1 < count and isinstance(arr[idx + 1], dict)
                else (1.0 if default_start_offset == 0.0 and default_span == 1.0 else min(1.0, default_start_offset + default_span))
            )
            p_end = _clamp01(item.get("progress_end"), fb_end)
            if p_end <= p_start:
                p_end = min(1.0, round(p_start + 0.04, 3))
            entry: dict[str, Any] = {
                "progress_start": _round_p(p_start),
                "progress_end": _round_p(p_end),
            }
            if "progress_at" in item:
                entry["progress_at"] = _round_p(_clamp01(item.get("progress_at"), p_start))
            out.append(entry)
        if out:
            timings[key] = out

    def _extract_event_list(key: str, base_start: float = 0.06, span: float = 0.68) -> None:
        arr = vdata.get(key)
        if not isinstance(arr, list) or not arr:
            return
        count = len(arr)
        out: list[dict[str, Any]] = []
        for idx, item in enumerate(arr):
            if not isinstance(item, dict):
                continue
            fb_start = base_start + (idx / max(1, count)) * span
            raw_start = item.get("progress_start", item.get("progress_at", item.get("show_at_progress")))
            p_start = _clamp01(raw_start, fb_start)
            entry: dict[str, Any] = {"progress_start": _round_p(p_start)}
            if "progress_at" in item:
                entry["progress_at"] = _round_p(_clamp01(item.get("progress_at"), p_start))
            if "progress_end" in item:
                entry["progress_end"] = _round_p(_clamp01(item.get("progress_end"), min(1.0, p_start + 0.1)))
            if "show_at_progress" in item:
                entry["show_at_progress"] = _round_p(_clamp01(item.get("show_at_progress"), p_start))
            out.append(entry)
        if out:
            timings[key] = out

    # Contiguous step templates
    _extract_contiguous_list("flow_steps", 0.0, 1.0)
    _extract_contiguous_list("highlight_phases", 0.0, 1.0)
    _extract_contiguous_list("steps", 0.0, 1.0)
    _extract_contiguous_list("milestones", 0.06, 0.86)

    # Event-based lists across code_cli, comparison_matrix, exam_tips, kpi_metrics
    _extract_event_list("terminal_commands", 0.25, 0.60)
    _extract_event_list("rows", 0.08, 0.62)
    _extract_event_list("comparisons", 0.0, 0.65)
    _extract_event_list("cards", 0.06, 0.36)
    _extract_event_list("metrics", 0.06, 0.36)
    _extract_event_list("bars", 0.40, 0.35)

    # Single reveal objects
    for obj_key, default_at in (
        ("quiz", 0.68),
        ("callout", 0.80),
        ("takeaway", 0.78),
        ("chart", 0.40),
        ("alert_stamp", 0.72),
    ):
        obj = vdata.get(obj_key)
        if isinstance(obj, dict):
            timings[obj_key] = {
                "show_at_progress": _round_p(_clamp01(obj.get("show_at_progress"), default_at))
            }

    return timings


def ensure_base_timings(scene: dict[str, Any]) -> dict[str, Any]:
    """Snapshot original AI timings into scene['_base_timings'] if not yet saved."""
    existing = scene.get("_base_timings")
    if isinstance(existing, dict) and existing:
        return existing
    snapshot = extract_scene_timings(scene)
    scene["_base_timings"] = copy.deepcopy(snapshot)
    return scene["_base_timings"]


def apply_scene_timings(scene: dict[str, Any], timings: dict[str, Any] | None) -> None:
    """Apply a timings dictionary onto scene['visual_data'] safely."""
    if not isinstance(timings, dict) or not timings:
        return
    vdata = scene.get("visual_data")
    if not isinstance(vdata, dict):
        return

    for list_key in (
        "flow_steps",
        "highlight_phases",
        "steps",
        "milestones",
        "terminal_commands",
        "rows",
        "comparisons",
        "cards",
        "metrics",
        "bars",
    ):
        t_arr = timings.get(list_key)
        v_arr = vdata.get(list_key)
        if not isinstance(t_arr, list) or not isinstance(v_arr, list):
            continue
        for idx in range(min(len(t_arr), len(v_arr))):
            t_item = t_arr[idx]
            v_item = v_arr[idx]
            if not isinstance(t_item, dict) or not isinstance(v_item, dict):
                continue
            if "progress_start" in t_item or "progress_at" in t_item:
                p_start = _round_p(_clamp01(t_item.get("progress_start", t_item.get("progress_at")), 0.0))
                v_item["progress_start"] = p_start
                if "progress_at" in v_item or "progress_at" in t_item:
                    v_item["progress_at"] = _round_p(_clamp01(t_item.get("progress_at"), p_start))
            if "progress_end" in t_item:
                v_item["progress_end"] = _round_p(_clamp01(t_item.get("progress_end"), 1.0))
            if "show_at_progress" in t_item:
                v_item["show_at_progress"] = _round_p(_clamp01(t_item.get("show_at_progress"), 0.5))

    for obj_key in ("quiz", "callout", "takeaway", "chart", "alert_stamp"):
        t_obj = timings.get(obj_key)
        v_obj = vdata.get(obj_key)
        if isinstance(t_obj, dict) and isinstance(v_obj, dict) and "show_at_progress" in t_obj:
            v_obj["show_at_progress"] = _round_p(_clamp01(t_obj.get("show_at_progress"), 0.68))


def _extract_item_cues(item: dict[str, Any], list_key: str) -> list[tuple[str, float]]:
    """Collect weighted (text, weight) cues from a visual step/item."""
    cues: list[tuple[str, float]] = []

    def _add(val: Any, weight: float) -> None:
        if isinstance(val, str) and val.strip():
            cues.append((val.strip(), weight))

    # Highest priority: explicit AI/author cue_text
    _add(item.get("cue_text"), 3.2)

    # Primary structural headings & commands
    for field in ("heading", "title", "label", "command", "cmd", "badge_text", "callout", "question", "criterion"):
        _add(item.get(field), 1.6)

    # Secondary descriptive cues
    for field in (
        "description",
        "explanation",
        "action",
        "tip",
        "wrong",
        "right",
        "value",
        "delta_text",
        "time_label",
        "packet_label",
        "annotate_text",
        "unit",
    ):
        _add(item.get(field), 1.0)

    # Console setup fields (prioritize highlighted fields)
    if list_key == "steps" and isinstance(item.get("fields"), list):
        for fld in item["fields"]:
            if not isinstance(fld, dict):
                continue
            w = 1.3 if fld.get("highlight") else 0.7
            _add(fld.get("label"), w)
            _add(fld.get("selected"), w)
            _add(fld.get("value"), w * 0.8)

    # Comparison matrix row cell values
    if list_key == "rows" and isinstance(item.get("values"), dict):
        for cell in item["values"].values():
            if isinstance(cell, dict):
                _add(cell.get("text"), 0.8)

    # Highlight phase lines/code_override summary if no callout/cue_text
    if list_key == "highlight_phases" and not cues:
        _add(item.get("code_override") if isinstance(item.get("code_override"), str) else "", 0.8)

    return cues


def _prepare_sub_entries(subtitles: list[dict[str, Any]], scene_duration: float) -> tuple[list[dict[str, Any]], float]:
    valid_subs = [
        s for s in (subtitles or [])
        if isinstance(s, dict) and str(s.get("text") or "").strip()
    ]
    if not valid_subs:
        return [], max(0.0, float(scene_duration or 0.0))

    dur = float(scene_duration or 0.0)
    if dur <= 0.0:
        dur = max(float(s.get("end_sec") or s.get("start_sec") or 0.0) for s in valid_subs)
    if dur <= 0.0:
        return [], 0.0

    entries: list[dict[str, Any]] = []
    for idx, sub in enumerate(valid_subs):
        txt = str(sub.get("text") or "").strip()
        start_sec = max(0.0, float(sub.get("start_sec") or 0.0))
        end_sec = max(start_sec, float(sub.get("end_sec") or start_sec))
        exact_toks, folded_toks = _tokenize_text(txt)
        entries.append({
            "index": idx,
            "text": txt,
            "norm_str": _normalize_for_substring(txt),
            "exact_set": set(exact_toks),
            "folded_set": set(folded_toks),
            "start_norm": _clamp01(start_sec / dur),
            "end_norm": _clamp01(end_sec / dur),
        })
    return entries, dur


def _score_cues_against_sub(cues: list[tuple[str, float]], sub_entry: dict[str, Any]) -> tuple[float, float]:
    """Return (match_score, estimated_progress_in_0_to_1) for cues against one subtitle entry."""
    if not cues or not sub_entry["folded_set"]:
        return 0.0, sub_entry["start_norm"]

    total_score = 0.0
    total_query_weight = 0.0
    best_char_pos: int | None = None
    best_char_weight = -1.0
    sub_str = sub_entry["norm_str"]

    for cue_text, weight in cues:
        exact_q, folded_q = _tokenize_text(cue_text)
        if not folded_q:
            continue

        seen_f: set[str] = set()
        unique_folded: list[str] = []
        for ft in folded_q:
            if ft not in seen_f:
                seen_f.add(ft)
                unique_folded.append(ft)

        total_query_weight += weight * len(unique_folded)
        cue_hits = 0.0

        for et, ft in zip(exact_q, folded_q):
            if ft in sub_entry["folded_set"]:
                # Longer technical terms/acronyms carry slightly higher specificity
                len_bonus = 1.35 if len(ft) >= 5 else 1.0
                accent_bonus = 1.15 if et in sub_entry["exact_set"] else 1.0
                cue_hits += weight * len_bonus * accent_bonus
                pos = sub_str.find(ft)
                if pos >= 0 and (weight > best_char_weight or (weight == best_char_weight and (best_char_pos is None or pos < best_char_pos))):
                    best_char_pos = pos
                    best_char_weight = weight

        # Bigram phrase bonus for multi-word cues
        if len(folded_q) >= 2:
            for k in range(len(folded_q) - 1):
                bigram = f"{folded_q[k]} {folded_q[k + 1]}"
                if len(bigram) >= 5 and bigram in sub_str:
                    cue_hits += weight * 1.8
                    bpos = sub_str.find(bigram)
                    if bpos >= 0 and weight >= best_char_weight:
                        best_char_pos = bpos
                        best_char_weight = weight + 0.5

        total_score += cue_hits

    if total_score <= 0.0:
        return 0.0, sub_entry["start_norm"]

    norm_factor = math.sqrt(max(1.0, total_query_weight))
    final_score = total_score / norm_factor

    cue_pos = sub_entry["start_norm"]
    if best_char_pos is not None and len(sub_str) > 20:
        char_ratio = best_char_pos / float(len(sub_str))
        if char_ratio > 0.30:
            span = max(0.0, sub_entry["end_norm"] - sub_entry["start_norm"])
            cue_pos = sub_entry["start_norm"] + min(0.75, char_ratio * 0.85) * span

    return final_score, _clamp01(cue_pos)


def _align_sequence_starts(
    items_cues: list[list[tuple[str, float]]],
    base_starts: list[float],
    sub_entries: list[dict[str, Any]],
    pin_first_to_zero: bool,
    min_gap: float,
    max_end: float,
) -> list[float]:
    """Monotonically align step start positions across subtitle entries with proportional fallback."""
    k_count = len(items_cues)
    if k_count == 0:
        return []

    safe_min_gap = min(min_gap, (max_end * 0.85) / max(1, k_count))

    def _enforce_monotonic(raw_starts: list[float]) -> list[float]:
        out = [_clamp01(v) for v in raw_starts]
        if pin_first_to_zero:
            out[0] = 0.0
        for idx in range(1, k_count):
            if out[idx] < out[idx - 1] + safe_min_gap:
                out[idx] = out[idx - 1] + safe_min_gap
        upper = min(max_end, 1.0 - safe_min_gap if pin_first_to_zero else max_end)
        if out[-1] > upper:
            out[-1] = upper
        for idx in range(k_count - 2, -1, -1):
            if out[idx] > out[idx + 1] - safe_min_gap:
                out[idx] = out[idx + 1] - safe_min_gap
        if pin_first_to_zero:
            out[0] = 0.0
            for idx in range(1, k_count):
                if out[idx] < out[idx - 1] + safe_min_gap:
                    out[idx] = out[idx - 1] + safe_min_gap
        else:
            if out[0] < 0.0:
                out[0] = 0.0
                for idx in range(1, k_count):
                    if out[idx] < out[idx - 1] + safe_min_gap:
                        out[idx] = out[idx - 1] + safe_min_gap
        return [_round_p(v) for v in out]

    if not sub_entries:
        return _enforce_monotonic(base_starts)

    m_count = len(sub_entries)
    scores: list[list[float]] = []
    cue_times: list[list[float]] = []
    has_match: list[bool] = []

    for i in range(k_count):
        row_s: list[float] = []
        row_t: list[float] = []
        best_s = 0.0
        for j in range(m_count):
            sc, tm = _score_cues_against_sub(items_cues[i], sub_entries[j])
            row_s.append(sc)
            row_t.append(tm)
            if sc > best_s:
                best_s = sc
        scores.append(row_s)
        cue_times.append(row_t)
        has_match.append(best_s >= 0.35)

    # Identify items that can be anchored via cue match; if pin_first_to_zero, index 0 is anchored at 0.0
    anchored_indices = [i for i in range(k_count) if has_match[i] and not (pin_first_to_zero and i == 0)]

    resolved: list[float | None] = [None] * k_count
    if pin_first_to_zero:
        resolved[0] = 0.0

    if anchored_indices:
        # Monotonic DP over anchored_indices -> subtitle index j in 0..M-1
        a_len = len(anchored_indices)
        dp = [[-1e9] * m_count for _ in range(a_len)]
        back = [[-1] * m_count for _ in range(a_len)]

        first_i = anchored_indices[0]
        for j in range(m_count):
            dist_pen = 0.15 * abs(cue_times[first_i][j] - base_starts[first_i])
            dp[0][j] = scores[first_i][j] - dist_pen

        for a_idx in range(1, a_len):
            cur_i = anchored_indices[a_idx]
            prev_i = anchored_indices[a_idx - 1]
            for j in range(m_count):
                dist_pen = 0.15 * abs(cue_times[cur_i][j] - base_starts[cur_i])
                cur_gain = scores[cur_i][j] - dist_pen
                best_prev_val = -1e9
                best_prev_j = 0
                for pj in range(j + 1):
                    # Slight preference for advancing subtitle index unless intra-subtitle position advances
                    same_sub_pen = 0.0
                    if pj == j:
                        if cue_times[cur_i][j] <= cue_times[prev_i][pj] + 0.005:
                            same_sub_pen = 0.35
                        else:
                            same_sub_pen = 0.08
                    cand = dp[a_idx - 1][pj] + cur_gain - same_sub_pen
                    if cand > best_prev_val:
                        best_prev_val = cand
                        best_prev_j = pj
                dp[a_idx][j] = best_prev_val
                back[a_idx][j] = best_prev_j

        best_last_j = max(range(m_count), key=lambda j: dp[a_len - 1][j])
        chosen_js = [0] * a_len
        cur_j = best_last_j
        for a_idx in range(a_len - 1, -1, -1):
            chosen_js[a_idx] = cur_j
            if a_idx > 0:
                cur_j = back[a_idx][cur_j]

        for a_idx, i in enumerate(anchored_indices):
            j = chosen_js[a_idx]
            if scores[i][j] >= 0.35:
                resolved[i] = cue_times[i][j]

    # Interpolate any unanchored items proportionally using _base_timings
    i = 0
    while i < k_count:
        if resolved[i] is not None:
            i += 1
            continue
        left_idx = i - 1
        right_idx = i + 1
        while right_idx < k_count and resolved[right_idx] is None:
            right_idx += 1

        left_t = resolved[left_idx] if left_idx >= 0 and resolved[left_idx] is not None else 0.0
        right_t = resolved[right_idx] if right_idx < k_count and resolved[right_idx] is not None else max_end

        left_b = base_starts[left_idx] if left_idx >= 0 else 0.0
        right_b = base_starts[right_idx] if right_idx < k_count else max_end
        base_span = right_b - left_b
        target_span = max(0.0, right_t - left_t)
        gap_count = right_idx - left_idx

        for fill_idx in range(max(0, left_idx + 1), min(k_count, right_idx)):
            if base_span > 1e-4:
                ratio = (base_starts[fill_idx] - left_b) / base_span
            else:
                ratio = (fill_idx - left_idx) / float(max(1, gap_count))
            ratio = max(0.0, min(1.0, ratio))
            resolved[fill_idx] = left_t + ratio * target_span

        i = right_idx

    final_raw = [v if v is not None else base_starts[idx] for idx, v in enumerate(resolved)]
    return _enforce_monotonic(final_raw)


def align_scene_timings(
    scene: dict[str, Any],
    subtitles: list[dict[str, Any]],
    scene_duration: float,
    apply_to_scene: bool = True,
) -> dict[str, Any]:
    """Align scene step timings to real TTS subtitle cues using _base_timings as reference."""
    base_timings = copy.deepcopy(ensure_base_timings(scene))
    vdata = scene.get("visual_data")
    if not isinstance(vdata, dict):
        return {}

    sub_entries, dur = _prepare_sub_entries(subtitles, scene_duration)
    if not sub_entries or dur <= 0.0:
        if apply_to_scene:
            apply_scene_timings(scene, base_timings)
        return base_timings

    new_timings: dict[str, Any] = {}

    # 1. Contiguous step templates: flow_steps, highlight_phases, steps, milestones
    for key, pin_zero in (
        ("flow_steps", True),
        ("highlight_phases", True),
        ("steps", True),
        ("milestones", False),
    ):
        arr = vdata.get(key)
        if not isinstance(arr, list) or not arr:
            continue
        base_arr = base_timings.get(key) or []
        base_starts = [
            float(base_arr[idx].get("progress_start", idx / max(1, len(arr))))
            if idx < len(base_arr) else (idx / max(1, len(arr)))
            for idx in range(len(arr))
        ]
        # Pin milestones[0] to 0.0 only if _base_timings started at ~0.0
        effective_pin = pin_zero or (bool(base_starts) and base_starts[0] <= 0.015)
        cues = [_extract_item_cues(item if isinstance(item, dict) else {}, key) for item in arr]
        max_last_start = 0.88 if (key == "milestones" and isinstance(vdata.get("callout"), dict)) else 0.94
        starts = _align_sequence_starts(
            items_cues=cues,
            base_starts=base_starts,
            sub_entries=sub_entries,
            pin_first_to_zero=effective_pin,
            min_gap=0.06,
            max_end=max_last_start,
        )
        t_list: list[dict[str, Any]] = []
        for idx in range(len(arr)):
            p_start = starts[idx]
            p_end = starts[idx + 1] if idx + 1 < len(arr) else 1.0
            entry: dict[str, Any] = {
                "progress_start": _round_p(p_start),
                "progress_end": _round_p(p_end),
            }
            orig_item = arr[idx] if isinstance(arr[idx], dict) else {}
            if "progress_at" in orig_item or (idx < len(base_arr) and "progress_at" in base_arr[idx]):
                entry["progress_at"] = _round_p(p_start)
            t_list.append(entry)
        new_timings[key] = t_list

    # 2. Event-based lists: terminal_commands, rows, comparisons, cards, metrics, bars
    event_configs = [
        ("terminal_commands", 0.94),
        ("rows", 0.84 if isinstance(vdata.get("takeaway"), dict) else 0.92),
        ("comparisons", 0.82 if isinstance(vdata.get("quiz"), dict) else 0.92),
        ("cards", 0.65 if isinstance(vdata.get("chart"), dict) else 0.88),
        ("metrics", 0.88),
        ("bars", 0.90),
    ]
    for key, max_end in event_configs:
        arr = vdata.get(key)
        if not isinstance(arr, list) or not arr:
            continue
        base_arr = base_timings.get(key) or []
        base_starts = [
            float(base_arr[idx].get("progress_start", idx / max(1, len(arr)) * max_end))
            if idx < len(base_arr) else (idx / max(1, len(arr)) * max_end)
            for idx in range(len(arr))
        ]
        cues = [_extract_item_cues(item if isinstance(item, dict) else {}, key) for item in arr]
        starts = _align_sequence_starts(
            items_cues=cues,
            base_starts=base_starts,
            sub_entries=sub_entries,
            pin_first_to_zero=False,
            min_gap=0.04,
            max_end=max_end,
        )
        t_list = []
        for idx, p_start in enumerate(starts):
            orig_item = arr[idx] if isinstance(arr[idx], dict) else {}
            b_item = base_arr[idx] if idx < len(base_arr) else {}
            entry = {"progress_start": _round_p(p_start)}
            if "progress_at" in orig_item or "progress_at" in b_item:
                entry["progress_at"] = _round_p(p_start)
            if "progress_end" in orig_item or "progress_end" in b_item:
                next_p = starts[idx + 1] if idx + 1 < len(starts) else 1.0
                entry["progress_end"] = _round_p(max(p_start + 0.04, next_p))
            if "show_at_progress" in orig_item or "show_at_progress" in b_item:
                entry["show_at_progress"] = _round_p(p_start)
            t_list.append(entry)
        new_timings[key] = t_list

    # 3. Single reveal objects: quiz, callout, takeaway, chart, alert_stamp
    def _align_single_reveal(obj_key: str, floor_t: float, default_at: float) -> None:
        obj = vdata.get(obj_key)
        if not isinstance(obj, dict):
            return
        base_obj = base_timings.get(obj_key) or {}
        base_at = float(base_obj.get("show_at_progress", default_at))
        cues: list[tuple[str, float]] = []
        for f, w in (
            ("cue_text", 3.2),
            ("question", 1.6),
            ("title", 1.5),
            ("text", 1.4),
            ("explanation", 1.0),
            ("unit", 0.8),
        ):
            val = obj.get(f)
            if isinstance(val, str) and val.strip():
                cues.append((val.strip(), w))

        best_sc = 0.0
        best_tm = max(floor_t, base_at)
        for sub in sub_entries:
            sc, tm = _score_cues_against_sub(cues, sub)
            if tm >= floor_t - 0.02 and sc > best_sc and sc >= 0.35:
                best_sc = sc
                best_tm = max(floor_t, tm)

        chosen = best_tm if best_sc >= 0.35 else max(floor_t, base_at)
        new_timings[obj_key] = {"show_at_progress": _round_p(max(floor_t, min(0.94, chosen)))}

    if isinstance(vdata.get("quiz"), dict):
        cmp_list = new_timings.get("comparisons") or []
        floor_q = (cmp_list[-1]["progress_start"] + 0.05) if cmp_list else 0.50
        _align_single_reveal("quiz", min(0.90, floor_q), 0.68)

    if isinstance(vdata.get("callout"), dict):
        ms_list = new_timings.get("milestones") or []
        floor_c = (ms_list[-1]["progress_start"] + 0.04) if ms_list else 0.65
        _align_single_reveal("callout", min(0.90, floor_c), 0.80)

    if isinstance(vdata.get("takeaway"), dict):
        rows_list = new_timings.get("rows") or []
        floor_tk = (rows_list[-1]["progress_start"] + 0.04) if rows_list else 0.65
        _align_single_reveal("takeaway", min(0.90, floor_tk), 0.78)

    if isinstance(vdata.get("chart"), dict):
        cards_list = new_timings.get("cards") or []
        floor_ch = (cards_list[-1]["progress_start"] + 0.05) if cards_list else 0.30
        _align_single_reveal("chart", min(0.85, floor_ch), 0.40)

    if isinstance(vdata.get("alert_stamp"), dict):
        chart_t = new_timings.get("chart", {}).get("show_at_progress", 0.0)
        cards_list = new_timings.get("cards") or []
        cards_last = (cards_list[-1]["progress_start"] + 0.05) if cards_list else 0.0
        floor_al = max(chart_t + 0.05 if chart_t else 0.0, cards_last, 0.45)
        _align_single_reveal("alert_stamp", min(0.90, floor_al), 0.72)

    if apply_to_scene:
        apply_scene_timings(scene, new_timings)
    return new_timings


def _build_srt_from_voice_track(script: dict[str, Any], scene_data: dict[str, Any]) -> str:
    srt_entries: list[str] = []
    srt_idx = 1
    episode_cursor = 0.0
    for scene in script.get("scenes", []):
        sid = scene.get("id")
        sdata = scene_data.get(sid) if isinstance(scene_data, dict) else None
        subs = (sdata.get("subtitles") if isinstance(sdata, dict) else None) or scene.get("subtitles") or []
        dur = float((sdata.get("duration_sec") if isinstance(sdata, dict) else None) or scene.get("duration_sec") or 0.0)
        for sub in subs:
            if not isinstance(sub, dict):
                continue
            start_sec = float(sub.get("start_sec") or 0.0)
            end_sec = float(sub.get("end_sec") or start_sec)
            txt = str(sub.get("text") or "").strip()
            if not txt:
                continue
            srt_entries.append(
                f"{srt_idx}\n"
                f"{format_srt_time(episode_cursor + start_sec)} --> "
                f"{format_srt_time(episode_cursor + end_sec)}\n"
                f"{txt}\n"
            )
            srt_idx += 1
        episode_cursor += dur
    return "\n".join(srt_entries)


def migrate_legacy_voice_track(script: dict[str, Any], ep_dir: Path) -> str | None:
    """If an episode has legacy root audio/<scene_id>.<ext> files without voice_tracks, migrate them cleanly."""
    voice_tracks = script.get("voice_tracks")
    if isinstance(voice_tracks, dict) and voice_tracks:
        return script.get("active_voice_track")

    audio_dir = ep_dir / "audio"
    scenes = script.get("scenes") if isinstance(script.get("scenes"), list) else []
    legacy_found = False
    for sc in scenes:
        if not isinstance(sc, dict):
            continue
        sid = sc.get("id")
        rel = str(sc.get("audio_file") or "")
        if rel:
            rel_path = ep_dir / rel
            # Legacy path looks like audio/<scene_id>.<ext> (direct child of audio/)
            if rel_path.exists() and rel_path.is_file() and rel_path.parent.resolve() == audio_dir.resolve():
                legacy_found = True
                break
        if sid:
            for ext in ("mp3", "wav"):
                cand = audio_dir / f"{sid}.{ext}"
                if cand.exists() and cand.is_file():
                    legacy_found = True
                    break
        if legacy_found:
            break

    if not legacy_found:
        return None

    used_provs = script.get("tts_provider_used")
    prov_hint = used_provs[0] if isinstance(used_provs, list) and used_provs else script.get("tts_provider")
    legacy_id = sanitize_profile_id(
        script.get("tts_profile"),
        fallback_voice=script.get("tts_voice"),
        fallback_provider=prov_hint,
    )

    target_dir = audio_dir / legacy_id
    target_dir.mkdir(parents=True, exist_ok=True)
    scene_data: dict[str, Any] = {}
    total_dur = 0.0

    for sc in scenes:
        if not isinstance(sc, dict) or not sc.get("id"):
            continue
        sid = sc["id"]
        ensure_base_timings(sc)
        rel = str(sc.get("audio_file") or "")
        src_path: Path | None = None
        if rel:
            cand = ep_dir / rel
            if cand.exists() and cand.is_file():
                src_path = cand
        if src_path is None:
            for ext in ("mp3", "wav"):
                cand = audio_dir / f"{sid}.{ext}"
                if cand.exists() and cand.is_file():
                    src_path = cand
                    break

        new_rel = rel
        if src_path is not None:
            ext = src_path.suffix.lstrip(".").lower() or "mp3"
            dst_path = target_dir / f"{sid}.{ext}"
            if src_path.resolve() != dst_path.resolve():
                shutil.move(str(src_path), str(dst_path))
            new_rel = f"audio/{legacy_id}/{sid}.{ext}"
            sc["audio_file"] = new_rel

        sc_dur = float(sc.get("duration_sec") or 0.0)
        total_dur += sc_dur
        sc_subs = sc.get("subtitles") if isinstance(sc.get("subtitles"), list) else []
        sc_timings = extract_scene_timings(sc)
        scene_data[sid] = {
            "audio_file": new_rel,
            "duration_sec": round(sc_dur, 3),
            "subtitles": sc_subs,
            "timings": sc_timings,
        }

    legacy_srt_name = f"subtitles.{legacy_id}.srt"
    root_srt = ep_dir / "subtitles.srt"
    legacy_srt = ep_dir / legacy_srt_name
    if root_srt.exists() and root_srt.is_file():
        shutil.copy2(str(root_srt), str(legacy_srt))
    else:
        srt_text = _build_srt_from_voice_track(script, scene_data)
        if srt_text:
            legacy_srt.write_text(srt_text, encoding="utf-8")
            root_srt.write_text(srt_text, encoding="utf-8")

    script["voice_tracks"] = {
        legacy_id: {
            "tts_profile": script.get("tts_profile") or legacy_id,
            "tts_provider": prov_hint or "edge",
            "tts_voice": script.get("tts_voice") or "",
            "tts_rate": script.get("tts_rate") or "+0%",
            "subtitles_srt": legacy_srt_name,
            "total_duration_sec": round(float(script.get("total_duration_sec") or total_dur), 3),
            "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "scene_data": scene_data,
        }
    }
    script["active_voice_track"] = legacy_id
    return legacy_id


def process_episode(
    script_path: Path,
    voices_cfg: dict[str, Any],
    course_path: Path | None,
    cli_profile: str | None,
    cli_provider: str | None,
    cli_voice: str | None,
    cli_rate: str | None,
    cli_pitch: str | None,
    quiet: bool = False,
) -> dict[str, Any]:
    script = json.loads(script_path.read_text(encoding="utf-8"))
    ep_dir = script_path.parent
    audio_dir = ep_dir / "audio"
    audio_dir.mkdir(parents=True, exist_ok=True)

    resolved_course_path = course_path or _auto_detect_course_path(script_path)
    course_data: dict[str, Any] | None = None
    if resolved_course_path and resolved_course_path.exists():
        try:
            course_data = json.loads(resolved_course_path.read_text(encoding="utf-8"))
        except Exception:
            course_data = None

    config = resolve_voice_config(
        voices_cfg,
        script_data=script,
        course_data=course_data,
        cli_profile=cli_profile,
        cli_provider=cli_provider,
        cli_voice=cli_voice,
        cli_rate=cli_rate,
        cli_pitch=cli_pitch,
    )

    # Preserve existing voice tracks & migrate legacy root audio/ files before generating new track
    migrate_legacy_voice_track(script, ep_dir)
    if not isinstance(script.get("voice_tracks"), dict):
        script["voice_tracks"] = {}

    safe_profile_id = sanitize_profile_id(
        config.get("resolved_profile_id"),
        fallback_voice=config.get("voice_id"),
        fallback_provider=config.get("provider"),
    )
    track_audio_dir = audio_dir / safe_profile_id
    track_audio_dir.mkdir(parents=True, exist_ok=True)

    hint_fmt = config.get("response_format") or "mp3"
    srt_entries: list[str] = []
    srt_idx = 1
    episode_cursor = 0.0
    total_duration = 0.0
    providers_used: set[str] = set()
    track_scene_data: dict[str, Any] = {}

    for scene in script.get("scenes", []):
        scene_id = scene["id"]
        ensure_base_timings(scene)
        narration = scene.get("narration", "").strip()
        chunks = split_text_for_tts(narration, max_chars=165)

        mp3_buf = bytearray()
        wav_pcm_buf = bytearray()
        wav_params: tuple[int, int, int] | None = None
        scene_ext = "mp3"
        subtitles: list[dict[str, Any]] = []
        scene_cursor = 0.0

        for chunk in chunks:
            raw_audio, used = synthesize_chunk(chunk, config)
            providers_used.add(used)
            ext, payload, params, chunk_dur = measure_audio_chunk(raw_audio, hint=hint_fmt)

            if ext == "wav":
                scene_ext = "wav"
                if wav_params is None:
                    wav_params = params
                wav_pcm_buf.extend(payload)
            else:
                mp3_buf.extend(payload)

            start_sec = round(scene_cursor, 3)
            end_sec = round(scene_cursor + chunk_dur, 3)
            subtitles.append({
                "text": chunk,
                "start_sec": start_sec,
                "end_sec": end_sec,
            })

            srt_entries.append(
                f"{srt_idx}\n"
                f"{format_srt_time(episode_cursor + start_sec)} --> "
                f"{format_srt_time(episode_cursor + end_sec)}\n"
                f"{chunk}\n"
            )
            srt_idx += 1
            scene_cursor += chunk_dur
            time.sleep(0.05)

        if scene_ext == "wav" and wav_params is not None:
            final_bytes = build_wav_bytes(wav_params, bytes(wav_pcm_buf))
            nch, sw, sr = wav_params
            scene_duration = round(len(wav_pcm_buf) / float(max(1, nch * sw * sr)), 3)
        else:
            scene_ext = "mp3"
            final_bytes = bytes(mp3_buf)
            scene_duration = round(scene_cursor, 3)

        audio_rel = f"audio/{safe_profile_id}/{scene_id}.{scene_ext}"
        audio_path = ep_dir / audio_rel
        audio_path.write_bytes(final_bytes)

        # Layer 1 Auto Subtitle-Cue Alignment using _base_timings reference
        aligned_timings = align_scene_timings(scene, subtitles, scene_duration, apply_to_scene=True)

        scene["audio_file"] = audio_rel
        scene["duration_sec"] = scene_duration
        scene["subtitles"] = subtitles

        track_scene_data[scene_id] = {
            "audio_file": audio_rel,
            "duration_sec": scene_duration,
            "subtitles": subtitles,
            "timings": aligned_timings,
        }

        episode_cursor += scene_duration
        total_duration += scene_duration
        if not quiet:
            print(
                f"[OK] {scene_id}: {len(chunks)} chunks | {scene_duration:.2f}s | "
                f"{audio_rel} ({audio_path.stat().st_size} bytes)"
            )

    srt_content = "\n".join(srt_entries)
    track_srt_rel = f"subtitles.{safe_profile_id}.srt"
    track_srt_path = ep_dir / track_srt_rel
    track_srt_path.write_text(srt_content, encoding="utf-8")

    root_srt_path = ep_dir / "subtitles.srt"
    root_srt_path.write_text(srt_content, encoding="utf-8")

    effective_profile = config.get("resolved_profile_id") or safe_profile_id
    used_list = sorted(providers_used)
    provider_label = used_list[0] if len(used_list) == 1 else (config.get("provider") or "edge")

    script["voice_tracks"][safe_profile_id] = {
        "tts_profile": effective_profile,
        "tts_provider": provider_label,
        "tts_voice": config.get("voice_id"),
        "tts_rate": config.get("rate"),
        "tts_pitch": config.get("pitch"),
        "subtitles_srt": track_srt_rel,
        "total_duration_sec": round(total_duration, 3),
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "scene_data": track_scene_data,
    }
    script["active_voice_track"] = safe_profile_id

    script["tts_profile"] = effective_profile
    script["tts_voice"] = config.get("voice_id")
    if config.get("rate"):
        script["tts_rate"] = config["rate"]
    script["tts_provider_used"] = used_list
    script["total_duration_sec"] = round(total_duration, 3)

    _write_json_atomic(script_path, script)

    if not quiet:
        print(f"\nEpisode total duration: {total_duration:.2f}s | Track: {safe_profile_id} | SRT: {root_srt_path}")

    return {
        "ok": True,
        "episode_id": script.get("episode_id") or ep_dir.name,
        "active_voice_track": safe_profile_id,
        "voice_tracks": sorted(script["voice_tracks"].keys()),
        "tts_profile": script.get("tts_profile"),
        "tts_voice": script.get("tts_voice"),
        "tts_provider_used": script.get("tts_provider_used"),
        "total_duration_sec": script["total_duration_sec"],
        "scenes_count": len(script.get("scenes", [])),
        "srt_path": str(root_srt_path),
        "track_srt_path": str(track_srt_path),
    }


def realign_episode(
    script_path: Path,
    scene_id: str | None = None,
    profile_id: str | None = None,
    quiet: bool = False,
) -> dict[str, Any]:
    """Re-run Layer 1 subtitle-cue alignment without regenerating TTS audio."""
    script = json.loads(script_path.read_text(encoding="utf-8"))
    ep_dir = script_path.parent

    migrate_legacy_voice_track(script, ep_dir)
    voice_tracks = script.get("voice_tracks") if isinstance(script.get("voice_tracks"), dict) else {}
    active_track_id = script.get("active_voice_track")

    target_profile: str | None = None
    if profile_id:
        safe_req = sanitize_profile_id(profile_id)
        if profile_id in voice_tracks:
            target_profile = profile_id
        elif safe_req in voice_tracks:
            target_profile = safe_req
        elif voice_tracks:
            avail = ", ".join(sorted(voice_tracks.keys()))
            raise ValueError(f"Voice track '{profile_id}' not found in script.json. Available: {avail}")
        else:
            target_profile = safe_req
    elif active_track_id and active_track_id in voice_tracks:
        target_profile = active_track_id
    elif voice_tracks:
        target_profile = next(iter(voice_tracks.keys()))
        script["active_voice_track"] = target_profile
        active_track_id = target_profile

    scenes = script.get("scenes") if isinstance(script.get("scenes"), list) else []
    target_scenes = [s for s in scenes if isinstance(s, dict) and (not scene_id or s.get("id") == scene_id)]
    if scene_id and not target_scenes:
        raise ValueError(f"Scene '{scene_id}' not found in {script_path}")

    apply_active_visuals = (target_profile is None) or (target_profile == active_track_id) or (active_track_id is None)
    track_obj = voice_tracks.get(target_profile) if target_profile else None
    track_scenes = track_obj.setdefault("scene_data", {}) if isinstance(track_obj, dict) else None

    aligned_scenes: list[str] = []
    timings_by_scene: dict[str, Any] = {}

    for sc in target_scenes:
        sid = sc.get("id")
        if not sid:
            continue
        ensure_base_timings(sc)
        sdata = track_scenes.get(sid) if isinstance(track_scenes, dict) and isinstance(track_scenes.get(sid), dict) else {}
        subs = sdata.get("subtitles") if isinstance(sdata.get("subtitles"), list) else sc.get("subtitles", [])
        dur = float(sdata.get("duration_sec") or sc.get("duration_sec") or 0.0)

        aligned = align_scene_timings(sc, subs, dur, apply_to_scene=apply_active_visuals)
        if isinstance(track_scenes, dict):
            entry = track_scenes.setdefault(sid, {
                "audio_file": sdata.get("audio_file") or sc.get("audio_file") or "",
                "duration_sec": round(dur, 3),
                "subtitles": subs,
            })
            entry["timings"] = aligned

        aligned_scenes.append(sid)
        timings_by_scene[sid] = aligned
        if not quiet:
            print(f"[REALIGN] {sid} (profile={target_profile or 'default'}): {len(aligned)} timing group(s)")

    _write_json_atomic(script_path, script)

    return {
        "ok": True,
        "mode": "realign_only",
        "episode_id": script.get("episode_id") or ep_dir.name,
        "profile_id": target_profile,
        "active_voice_track": script.get("active_voice_track"),
        "aligned_scenes": aligned_scenes,
        "timings_by_scene": timings_by_scene,
    }


def _emit_error(message: str, as_json: bool) -> int:
    if as_json:
        print(json.dumps({"ok": False, "error": message}, ensure_ascii=False))
    else:
        print(f"Error: {message}", file=sys.stderr)
    return 1


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Pluggable pure-Python TTS & synchronized subtitle pipeline."
    )
    parser.add_argument("--episode", help="Path to episode script.json")
    parser.add_argument("--course", help="Optional path to course.json (auto-detected if omitted)")
    parser.add_argument("--voices", help="Optional path to voices.json")
    parser.add_argument("--profile", help="Voice profile id from voices.json")
    parser.add_argument(
        "--provider",
        choices=["auto", "edge", "google", "voicestudio", "openai_compat", "custom_http"],
        default=None,
        help="Optional provider override (use 'auto' to allow Google fallback)",
    )
    parser.add_argument("--voice", default=None, help="Optional TTS voice_id override")
    parser.add_argument("--rate", default=None, help="Optional speaking rate override (e.g. +6%% or 1.0)")
    parser.add_argument("--pitch", default=None, help="Optional pitch override (e.g. +0Hz or -2Hz)")

    # Utility & Web Studio CLI modes
    parser.add_argument("--realign-only", action="store_true", help="Re-align scene timings from existing subtitles without TTS")
    parser.add_argument("--scene", default=None, help="Optional single scene_id filter for --realign-only")
    parser.add_argument("--list-profiles", action="store_true", help="List profiles from voices.json")
    parser.add_argument("--discover-voicestudio", action="store_true", help="Probe local VoiceStudio voices")
    parser.add_argument("--preview", action="store_true", help="Synthesize a single sample audio file")
    parser.add_argument("--text", default=None, help="Text for --preview mode")
    parser.add_argument("--out", default=None, help="Output file path for --preview mode")
    parser.add_argument("--json", action="store_true", dest="as_json", help="Print machine-readable JSON output")
    args = parser.parse_args()

    # Ensure UTF-8 stdout on Windows consoles
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except Exception:
            pass

    voices_path = Path(args.voices).resolve() if args.voices else DEFAULT_VOICES_PATH
    voices_cfg = load_voices_config(voices_path)

    if args.list_profiles:
        payload = {
            "ok": True,
            "default_profile": voices_cfg.get("default_profile"),
            "voicestudio_base_url": voices_cfg.get("voicestudio_base_url"),
            "profiles": voices_cfg.get("profiles", []),
        }
        if args.as_json:
            print(json.dumps(payload, ensure_ascii=False))
        else:
            print(f"Default profile: {payload['default_profile']}")
            for p in payload["profiles"]:
                print(f"  - {p.get('id')}: {p.get('label')} [{p.get('provider')} / {p.get('voice_id')}]")
        return 0

    if args.discover_voicestudio:
        base_url = os.environ.get("VOICESTUDIO_BASE_URL") or voices_cfg.get("voicestudio_base_url") or "http://localhost:8000"
        res = discover_voicestudio(base_url, timeout=1.5)
        if args.as_json:
            print(json.dumps(res, ensure_ascii=False))
        else:
            status = "ONLINE" if res["reachable"] else "OFFLINE"
            print(f"VoiceStudio ({res['base_url']}): {status} | {len(res['voices'])} voice(s)")
            for v in res["voices"]:
                print(f"  - {v['id']}: {v.get('label', '')}")
        return 0

    if args.preview:
        if not args.out:
            return _emit_error("--preview requires --out <filepath>", args.as_json)
        try:
            res = process_preview(
                voices_cfg=voices_cfg,
                out_path=Path(args.out).resolve(),
                text=args.text,
                cli_profile=args.profile,
                cli_provider=args.provider,
                cli_voice=args.voice,
                cli_rate=args.rate,
                cli_pitch=args.pitch,
            )
            if args.as_json:
                print(json.dumps(res, ensure_ascii=False))
            else:
                print(f"[OK] Preview written to {res['out']} ({res['duration_sec']}s via {res['provider_used']})")
            return 0
        except Exception as exc:
            return _emit_error(str(exc), args.as_json)

    if not args.episode:
        return _emit_error("Provide --episode <script.json>, --preview, --list-profiles, or --discover-voicestudio", args.as_json)

    script_path = Path(args.episode).resolve()
    if not script_path.exists():
        return _emit_error(f"script.json not found at {script_path}", args.as_json)

    if args.realign_only:
        try:
            res = realign_episode(
                script_path=script_path,
                scene_id=args.scene,
                profile_id=args.profile,
                quiet=args.as_json,
            )
            if args.as_json:
                print(json.dumps(res, ensure_ascii=False))
            return 0
        except Exception as exc:
            return _emit_error(str(exc), args.as_json)

    course_path = Path(args.course).resolve() if args.course else None
    try:
        res = process_episode(
            script_path=script_path,
            voices_cfg=voices_cfg,
            course_path=course_path,
            cli_profile=args.profile,
            cli_provider=args.provider,
            cli_voice=args.voice,
            cli_rate=args.rate,
            cli_pitch=args.pitch,
            quiet=args.as_json,
        )
        if args.as_json:
            print(json.dumps(res, ensure_ascii=False))
        return 0
    except Exception as exc:
        return _emit_error(str(exc), args.as_json)


if __name__ == "__main__":
    raise SystemExit(main())
