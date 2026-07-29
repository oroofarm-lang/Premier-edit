#!/usr/bin/env python3
"""Transcribe an audio file with faster-whisper and print JSON to stdout.

Called by lib/transcription/local-whisper.ts. Kept deliberately small: the
Node side owns all pipeline logic, this only wraps the model.

Progress is written to stderr so stdout stays pure JSON.
"""

import argparse
import json
import sys


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("audio", help="Path to a 16kHz mono WAV file")
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

    segments, info = model.transcribe(
        args.audio,
        language=args.language,
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
        print(f"segment {len(collected)} @ {segment.end:.1f}s", file=sys.stderr)

    json.dump(
        {
            "language": info.language,
            "languageProbability": round(info.language_probability, 4),
            "durationSec": round(info.duration, 3),
            "text": " ".join(s["text"] for s in collected),
            "segments": collected,
        },
        sys.stdout,
        ensure_ascii=False,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
