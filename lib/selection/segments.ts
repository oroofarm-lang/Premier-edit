// Shared between content selection and vision analysis: both need the same
// answer to "what time ranges in this asset are worth looking at" — content
// selection to build candidates, vision analysis to know what to describe.
// Keeping one definition means a transcript segment always gets exactly the
// visual analysis meant for it, by construction, rather than by the two
// call sites happening to agree.

export type AssetSegment = {
  startSec: number;
  endSec: number;
  /** Spoken text for this span, "" if there is none (silent or no transcript). */
  text: string;
};

/**
 * Real transcript segments when there is speech; otherwise the whole clip as
 * one segment, since a silent clip still needs *some* range for a vision
 * model to describe — without this a clip with no speech is invisible to
 * selection no matter how visually relevant it is (see CLAUDE.md).
 */
export function getAssetSegments(asset: {
  transcript: { segmentsJson: string } | null;
  durationSec: number | null;
}): AssetSegment[] {
  if (asset.transcript) {
    const segments = JSON.parse(asset.transcript.segmentsJson) as AssetSegment[];
    if (segments.length > 0) return segments;
  }
  if (asset.durationSec) {
    return [{ startSec: 0, endSec: asset.durationSec, text: "" }];
  }
  return [];
}
