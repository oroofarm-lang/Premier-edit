export type CutClip = {
  /** Source file on disk, referenced by the exported timeline. */
  filePath: string;
  fileName: string;
  hasVideo: boolean;
  hasAudio: boolean;
  /** Source in/out, in seconds. */
  sourceInSec: number;
  sourceOutSec: number;
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
