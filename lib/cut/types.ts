export type CutClip = {
  /** Source file on disk, referenced by the exported timeline. */
  filePath: string;
  fileName: string;
  hasVideo: boolean;
  hasAudio: boolean;
  /** Source in/out, in seconds. */
  sourceInSec: number;
  sourceOutSec: number;
  /**
   * Audio-only in/out, in source seconds. Deliberately wider than
   * sourceInSec/sourceOutSec by half the crossfade overlap on each side that
   * has a neighbor — the video cut stays exactly where selection put it, only
   * the audio track reaches into real, not-otherwise-used source footage so a
   * crossfade transition has material to blend (confirmed against a real
   * Premiere-exported reference file: a transition with no spare footage on
   * either side just produces a hard cut, not a dissolve). Equal to
   * sourceInSec/sourceOutSec for a clip with no neighbor on that side (first
   * clip's start, last clip's end).
   */
  audioInSec: number;
  audioOutSec: number;
  /** Position on the timeline, in seconds. */
  timelineStartSec: number;
  timelineEndSec: number;
  /** Full source duration, needed by the XML file reference. */
  sourceDurationSec: number;
  /**
   * The source's own frame rate, which is NOT necessarily the sequence rate —
   * a phone clip at 30fps and a camera clip at 25fps can sit in one cut. Source
   * in/out points are expressed in the source's frames, so exporting them at the
   * sequence rate would read the wrong part of the file. Null for audio-only.
   */
  fps: number | null;
  width: number | null;
  height: number | null;
  /**
   * Footage to place on the video track instead of this clip's own, when the
   * moment's picture and sound deliberately come from different sources
   * (B-roll cutaway). Every other field above still describes the audio side.
   * Already fitted to this clip's duration by resolveVideoOverride, so the
   * timeline position is unchanged either way.
   */
  videoOverride?: {
    filePath: string;
    fileName: string;
    sourceInSec: number;
    sourceOutSec: number;
  };
};

export type CutTimeline = {
  name: string;
  /** Sequence frame rate. Sources with other rates get conformed by Premiere. */
  fps: number;
  width: number;
  height: number;
  durationSec: number;
  clips: CutClip[];
};
