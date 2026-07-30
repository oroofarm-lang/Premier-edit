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
