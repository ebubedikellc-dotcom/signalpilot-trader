"""Permissioned video -> timestamped speech + sampled OCR, never model fine-tuning.

Runs separately from the trading server. Only claims jobs uploaded by the owner.
Requires TRADE_LORD_SITE_URL and TRADE_LORD_VIDEO_WORKER_TOKEN; see TRADE-LORD.md.
"""
import json
import math
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from video_sources import download_video
from urllib.parse import urlparse
from urllib.request import Request, build_opener, HTTPRedirectHandler


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def command(args, timeout=90):
    return subprocess.run(args, check=True, capture_output=True, timeout=timeout).stdout


def extract_video(source, target):
    # Decoders get a local file, no network protocols or shell commands.
    info = json.loads(command(["ffprobe", "-v", "error", "-protocol_whitelist", "file,pipe",
                               "-show_format", "-show_streams", "-of", "json", source]))
    duration = float(info.get("format", {}).get("duration", 0))
    if not math.isfinite(duration) or not 0 < duration <= 3600:
        raise ValueError("Use a video of up to 60 minutes with a readable duration.")
    streams = info.get("streams", [])
    if not any(s.get("codec_type") == "video" for s in streams):
        raise ValueError("No video track was found.")
    segments, language = [], "und"
    has_audio = any(s.get("codec_type") == "audio" for s in streams)
    with tempfile.TemporaryDirectory(prefix="trade-lord-extract-") as temp:
        root = Path(temp)
        if has_audio:
            wav = str(root / "audio.wav")
            command(["ffmpeg", "-nostdin", "-v", "error", "-protocol_whitelist", "file,pipe",
                     "-threads", "1", "-i", source, "-vn", "-t", "3600", "-ac", "1", "-ar", "16000", wav], timeout=240)
            from faster_whisper import WhisperModel
            model = WhisperModel(os.environ.get("TRADE_LORD_WHISPER_MODEL", "small"), device="cpu",
                                 compute_type="int8", cpu_threads=2, num_workers=1)
            transcript, details = model.transcribe(wav, beam_size=5, vad_filter=True,
                                                   condition_on_previous_text=False)
            language = details.language
            for part in transcript:
                if part.no_speech_prob > 0.85 or part.avg_logprob < -1.2:
                    continue
                segments.append({"start": part.start, "end": min(part.end, duration),
                                 "text": part.text.strip(), "kind": "speech"})
        # Read visible words periodically. This is not chart/animation understanding.
        ocr_enabled = bool(shutil.which("tesseract"))
        if ocr_enabled:
            previous = None
            for seconds in range(0, math.ceil(duration), 30):
                frame = str(root / "frame.png")
                command(["ffmpeg", "-nostdin", "-y", "-v", "error", "-protocol_whitelist", "file,pipe",
                         "-threads", "1", "-ss", str(seconds), "-i", source, "-frames:v", "1",
                         "-vf", "scale=1280:720:force_original_aspect_ratio=decrease", frame])
                text = command(["tesseract", frame, "stdout", "-l", "eng", "--psm", "11"], timeout=30).decode("utf-8").strip()
                if text and text != previous:
                    segments.append({"start": seconds, "end": min(seconds + 30, duration),
                                     "text": text, "kind": "screen-text"})
                previous = text
        segments.sort(key=lambda s: (s["start"], s["kind"]))
        if not segments:
            raise ValueError("No clear speech or readable screen text was found. Try a clearer video.")
        if sum(len(s["text"]) for s in segments) > 300000:
            raise ValueError("Transcript is too large. Split the video into shorter parts.")
        methods = (["faster-whisper"] if has_audio else []) + (["sampled OCR"] if ocr_enabled else [])
        coverage = ("Machine-transcribed speech. " if has_audio else "No audio track. ") + ("Screen text sampled every 30 seconds using English OCR. " if ocr_enabled else "Screen text was not read. ")
        result = {"segments": segments, "language": language, "method": " + ".join(methods),
                  "coverage": coverage + "Charts, gestures and other visual meaning have not been interpreted. Important numbers need checking."}
        Path(target).write_text(json.dumps(result), encoding="utf-8")


def run_worker():
    base = os.environ.get("TRADE_LORD_SITE_URL", "").rstrip("/")
    token = os.environ.get("TRADE_LORD_VIDEO_WORKER_TOKEN", "")
    parsed = urlparse(base)
    if parsed.scheme != "https" and not (parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1"}):
        raise SystemExit("Set an HTTPS TRADE_LORD_SITE_URL.")
    if len(token) < 32:
        raise SystemExit("Set a matching video-worker secret of at least 32 characters.")
    opener = build_opener(NoRedirect())
    def request(route, payload=None, extra_headers=None):
        headers = {"Authorization": "Bearer " + token, **(extra_headers or {})}
        body = None
        if payload is not None:
            headers["Content-Type"] = "application/json"
            body = json.dumps(payload).encode()
        return opener.open(Request(base + "/api/trade-lord/training/worker/" + route,
                                   data=body, headers=headers), timeout=60)
    def api(route, payload):
        with request(route, payload) as response:
            return json.load(response)
    while True:
        try:
            job = api("claim", {}).get("job")
        except Exception:
            print("Video server unavailable. Retrying without exposing credentials.", flush=True)
            time.sleep(15)
            continue
        if not job:
            time.sleep(15)
            continue
        route, lease = job["id"], job["lease"]
        child = None
        try:
            with tempfile.TemporaryDirectory(prefix="trade-lord-job-") as temp:
                source, output = str(Path(temp) / "input.video"), str(Path(temp) / "result.json")
                remote_bytes = 0
                if job.get("downloadUrl"):
                    archive_setting = os.environ.get("TRADE_LORD_VIDEO_ARCHIVE_DIR", "")
                    if not archive_setting:
                        raise ValueError("Connect persistent video storage before processing links. Your source link remains saved.")
                    archive = Path(archive_setting)
                    archive.mkdir(parents=True, exist_ok=True, mode=0o700)
                    source = str(archive / (job["id"] + ".video"))
                    if not Path(source).exists():
                        used = sum(p.stat().st_size for p in archive.iterdir() if p.is_file())
                        if used + 100 * 1024 * 1024 > 500 * 1024 * 1024:
                            raise ValueError("Processor archive is full. Keep existing originals until reviewed; expand storage or release reviewed files.")
                        api(route + "/progress", {"lease": lease, "progress": "Downloading the authorized video source."})
                        download_video(job["downloadUrl"], source, os.environ.get("TRADE_LORD_VIDEO_SOURCE_HOSTS", ""))
                    remote_bytes = Path(source).stat().st_size
                else:
                    with request(route + "/file", extra_headers={"X-Job-Lease": lease}) as response, open(source, "wb") as file:
                        count = 0
                        while True:
                            block = response.read(1024 * 1024)
                            if not block:
                                break
                            count += len(block)
                            if count > min(job["bytes"], 100 * 1024 * 1024):
                                raise ValueError("Downloaded video exceeds its limit.")
                            file.write(block)
                    if count != job["bytes"]:
                        raise ValueError("Video download was incomplete.")
                # The child has no API token, cannot claim jobs, and has bounded runtime.
                child_env = {k: v for k, v in os.environ.items() if k not in {"TRADE_LORD_VIDEO_WORKER_TOKEN", "TRADE_LORD_SITE_URL"}}
                child = subprocess.Popen([sys.executable, __file__, "--extract", source, output],
                                         env=child_env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                         start_new_session=True)
                began, heartbeat = time.monotonic(), 0
                while child.poll() is None:
                    elapsed = time.monotonic() - began
                    if elapsed > 3600:
                        raise TimeoutError("Video processing took too long. Try a shorter video.")
                    if elapsed >= heartbeat:
                        api(route + "/progress", {"lease": lease, "progress": "Reading speech and screen text. Large videos take longer."})
                        heartbeat = elapsed + 30
                    time.sleep(2)
                if child.returncode:
                    raise ValueError("The video could not be processed. Check the processor's model and dependencies, or try a clearer, shorter video.")
                if Path(output).stat().st_size > 1900000:
                    raise ValueError("Video transcript is too large. Split the video into shorter parts.")
                result = json.loads(Path(output).read_text(encoding="utf-8"))
                api(route + "/complete", {**result, "lease": lease, "archivedBytes": remote_bytes, "retentionReason": "Full original kept for visual/audio review. This processor extracts speech and sampled text, not complete visual meaning."})
                print("Video knowledge saved.", flush=True)
        except Exception as error:
            if child and child.poll() is None:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait()
            # No raw HTTP error, decoder output, file content or secret enters logs.
            message = str(error) if isinstance(error, (ValueError, TimeoutError)) else "Processing was interrupted. Please retry this video."
            try:
                api(route + "/complete", {"lease": lease, "error": message})
            except Exception:
                pass  # Its lease expires, allowing safe recovery by the next worker.
            print("Video needs attention. See its control-panel status.", flush=True)


if __name__ == "__main__":
    if len(sys.argv) == 4 and sys.argv[1] == "--extract":
        extract_video(sys.argv[2], sys.argv[3])
    else:
        run_worker()
