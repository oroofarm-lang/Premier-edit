import { describe, expect, it } from "vitest";
import { toTranscriptionResult, type RawWhisperResult } from "./local-whisper";

describe("toTranscriptionResult", () => {
  it("maps words with startSec/endSec when the engine provides them", () => {
    const raw: RawWhisperResult = {
      path: "/tmp/clip.wav",
      language: "he",
      languageProbability: 0.99,
      durationSec: 4,
      text: "שלום עולם",
      segments: [
        {
          start: 0,
          end: 1.2,
          text: "שלום עולם",
          words: [
            { word: "שלום", start: 0, end: 0.5 },
            { word: "עולם", start: 0.6, end: 1.2 },
          ],
        },
      ],
    };

    const result = toTranscriptionResult(raw, "local-whisper:large-v3");

    expect(result.segments[0].words).toEqual([
      { word: "שלום", startSec: 0, endSec: 0.5 },
      { word: "עולם", startSec: 0.6, endSec: 1.2 },
    ]);
  });

  it("leaves words undefined when the raw segment has none", () => {
    const raw: RawWhisperResult = {
      path: "/tmp/clip.wav",
      language: "he",
      languageProbability: 0.99,
      durationSec: 4,
      text: "שלום",
      segments: [{ start: 0, end: 1, text: "שלום" }],
    };

    const result = toTranscriptionResult(raw, "local-whisper:large-v3");

    expect(result.segments[0].words).toBeUndefined();
  });

  it("throws the engine's error message for a failed item", () => {
    const raw: RawWhisperResult = { path: "/tmp/bad.wav", error: "boom" };
    expect(() => toTranscriptionResult(raw, "local-whisper:large-v3")).toThrow(
      "boom",
    );
  });
});
