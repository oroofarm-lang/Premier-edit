#!/usr/bin/env python3
"""Transcribe one or more audio files with faster-whisper, print JSON to stdout.

Called by lib/transcription/local-whisper.ts. Kept deliberately small: the
Node side owns all pipeline logic, this only wraps the model.

Accepts multiple audio paths so the model is loaded once for the whole batch
instead of once per file — loading large-v3 dominates the runtime for short
clips, so batching is the difference between minutes and tens of minutes on a
folder of real footage.

Progress is written to stderr so stdout stays pure JSON. Output is a JSON
array, one entry per input path in the same order, each either
{"path", "language", ..., "segments"} on success or {"path", "error"} on
failure — one bad file does not abort the rest of the batch.
"""

import argparse
import json
import sys


def transcribe_one(model, audio_path: str, language: str) -> dict:
    segments, info = model.transcribe(
        audio_path,
        language=language,
        vad_filter=True,
        word_timestamps=False,
    )

    collected = []
    for segment in segments:
        text = segment.text.strip()
        if not text:
            continue
        collected.append(
            {
                "start": round(segment.start, 3),
                "end": round(segment.end, 3),
                "text": text,
            }
        )
        # Surface progress on long files rather than looking hung.
        print(f"  segment {len(collected)} @ {segment.end:.1f}s", file=sys.stderr)

    return {
        "path": audio_path,
        "language": info.language,
        "languageProbability": round(info.language_probability, 4),
        "durationSec": round(info.duration, 3),
        "text": " ".join(s["text"] for s in collected),
        "segments": collected,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("audio", nargs="+", help="Path(s) to 16kHz mono WAV files")
    parser.add_argument("--model", default="large-v3")
    parser.add_argument("--language", default="he")
    parser.add_argument(
        "--model-dir",
        default=None,
        help="Where to cache downloaded weights (defaults to the HF cache)",
    )
    args = parser.parse_args()

    from faster_whisper import WhisperModel

    # int8 keeps the large models usable on a laptop without a discrete GPU;
    # accuracy loss is small compared to dropping to a smaller model.
    model = WhisperModel(
        args.model,
        device="cpu",
        compute_type="int8",
        download_root=args.model_dir,
    )

    results = []
    for i, audio_path in enumerate(args.audio, start=1):
        print(f"[{i}/{len(args.audio)}] {audio_path}", file=sys.stderr)
        try:
            results.append(transcribe_one(model, audio_path, args.language))
        except Exception as exc:
            print(f"  failed: {exc}", file=sys.stderr)
            results.append({"path": audio_path, "error": str(exc)})

    json.dump(results, sys.stdout, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())
