/**
 * A moment's B-roll video and the audio it covers are chosen independently, so
 * their durations rarely match. The model only points at a good-looking visual;
 * making it line up frame-for-frame with the narration is mechanical, and lives
 * here rather than in the prompt.
 *
 * Extension only ever reaches into footage the source file actually has —
 * same rule as the crossfade handles in build.ts. When even the whole clip is
 * too short, the caller drops the override instead of looping or freezing.
 */
export function resolveVideoOverride(
  override: { startSec: number; endSec: number; sourceDurationSec: number },
  audioDurationSec: number,
): { startSec: number; endSec: number } | null {
  const { startSec, endSec, sourceDurationSec } = override;

  if (sourceDurationSec < audioDurationSec) return null;

  const available = endSec - startSec;
  if (available >= audioDurationSec) {
    return { startSec, endSec: startSec + audioDurationSec };
  }

  const extendedEnd = Math.min(sourceDurationSec, startSec + audioDurationSec);
  if (extendedEnd - startSec >= audioDurationSec) {
    return { startSec, endSec: extendedEnd };
  }

  // Not enough footage after startSec — take the shortfall from before it.
  return { startSec: extendedEnd - audioDurationSec, endSec: extendedEnd };
}
