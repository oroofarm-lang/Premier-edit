/**
 * Phase 2: execute an approved cut plan directly against Premiere's API.
 *
 * Every write goes through project.lockedAccess + project.executeTransaction,
 * which is how the Premiere UXP API requires timeline mutations to be made —
 * it also makes the whole build one undo step for the user.
 */

const ppro = require("premierepro");

const APP_ORIGIN = "http://localhost:3002";

async function fetchPlan(projectId) {
  const res = await fetch(`${APP_ORIGIN}/api/projects/${projectId}/timeline`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Plan fetch failed (HTTP ${res.status}): ${body}`);
  }
  return res.json();
}

async function fetchProjects() {
  const res = await fetch(`${APP_ORIGIN}/api/projects`);
  if (!res.ok) throw new Error(`Project list failed (HTTP ${res.status})`);
  const { projects } = await res.json();
  return projects;
}

/**
 * Imports any source file not already in the project, then maps each plan
 * clip's file path to its ProjectItem. Import is by absolute path, matching
 * what the pipeline stored at ingest.
 */
async function ensureMediaImported(project, plan, log) {
  const rootItem = await project.getRootItem();
  const existing = await rootItem.getItems();

  const byName = new Map();
  for (const item of existing) {
    byName.set(item.name, item);
  }

  const missing = [];
  for (const clip of plan.clips) {
    if (!byName.has(clip.fileName)) missing.push(clip.filePath);
    // A B-roll source may not be anywhere else in the plan's own file list.
    if (clip.videoOverride && !byName.has(clip.videoOverride.fileName)) {
      missing.push(clip.videoOverride.filePath);
    }
  }
  const toImport = [...new Set(missing)];

  if (toImport.length > 0) {
    log(`Importing ${toImport.length} source file(s)…`);
    const ok = await project.importFiles(toImport, true, rootItem, false);
    if (!ok) throw new Error("importFiles reported failure");

    const after = await rootItem.getItems();
    byName.clear();
    for (const item of after) byName.set(item.name, item);
  }

  const resolved = new Map();
  const needed = new Set();
  for (const clip of plan.clips) {
    needed.add(clip.fileName);
    if (clip.videoOverride) needed.add(clip.videoOverride.fileName);
  }
  for (const fileName of needed) {
    const item = byName.get(fileName);
    if (!item) {
      throw new Error(`Could not find ${fileName} in the project after import`);
    }
    resolved.set(fileName, item);
  }
  return resolved;
}

/** Scratch track indexes (V2/A2) used to park the half of a B-roll placement
 * we don't want. createOverwriteItemAction always places both a clip's video
 * and its audio — there is no video-only or audio-only variant — so the way to
 * end up with one source's picture over another's sound is to send the unwanted
 * halves to tracks nobody reads, then sweep them. */
// Deliberately well clear of the tracks the cut itself uses: a stereo source
// dropped into a sequence with mono tracks occupies TWO audio tracks, so a
// scratch index of 1 lands on the second channel of the real audio and
// silently destroys it. Observed in Premiere, not theoretical.
const SCRATCH_VIDEO_TRACK = 2;
const SCRATCH_AUDIO_TRACK = 4;

/** Trims a project item to an in/out range, so the following overwrite edit
 * inserts exactly the chosen moment rather than the whole file.
 *
 * Setting in/out is the one call that needs the ClipProjectItem cast; the
 * overwrite edit below takes the raw ProjectItem and rejects the cast one
 * with "Invalid parameter" (matches Adobe's own samples). */
function setInOut(project, projectItem, inSec, outSec, label) {
  const clipItem = ppro.ClipProjectItem.cast(projectItem);
  try {
    project.lockedAccess(() => {
      project.executeTransaction((compoundAction) => {
        compoundAction.addAction(
          clipItem.createSetInOutPointsAction(
            ppro.TickTime.createWithSeconds(inSec),
            ppro.TickTime.createWithSeconds(outSec),
          ),
        );
      }, label);
    });
  } catch (err) {
    throw new Error(`setInOut(${inSec}→${outSec}) failed [${label}]: ${err.message}`);
  }
}

function overwriteAt(project, editor, clipItem, atSec, videoTrack, audioTrack, label) {
  try {
    project.lockedAccess(() => {
      project.executeTransaction((compoundAction) => {
        compoundAction.addAction(
          editor.createOverwriteItemAction(
            clipItem,
            ppro.TickTime.createWithSeconds(atSec),
            videoTrack,
            audioTrack,
          ),
        );
      }, label);
    });
  } catch (err) {
    throw new Error(
      `overwrite at ${atSec}s on V${videoTrack + 1}/A${audioTrack + 1} failed [${label}]: ${err.message}`,
    );
  }
}

/** Empties the scratch tracks left behind by B-roll placements. Ripple is
 * false throughout — removing these must not shift anything already placed. */
/**
 * Removes every clip from the given tracks. Shared by scratch-track cleanup
 * and by the sweep that empties a freshly created sequence, because the two
 * need identical, fiddly handling of Premiere's object lifetimes.
 */
async function clearTrackItems(project, trackSpecs, label) {
  // Re-fetch rather than reusing the handles from placement: after a run of
  // transactions the earlier sequence/editor objects go stale and every call
  // on them fails with "The script object is no longer valid."
  const sequence = await project.getActiveSequence();
  if (!sequence) return 0;
  const editor = ppro.SequenceEditor.getEditor(sequence);

  const passes = [];
  for (const spec of trackSpecs) {
    const track =
      spec.mediaType === ppro.Constants.MediaType.VIDEO
        ? await sequence.getVideoTrack(spec.index)
        : await sequence.getAudioTrack(spec.index);
    passes.push({ track, mediaType: spec.mediaType });
  }

  let cleared = 0;
  for (const { track, mediaType } of passes) {
    if (!track) continue;
    const items = await track.getTrackItems(ppro.Constants.TrackItemType.CLIP, false);
    if (items.length === 0) continue;

    // The selection is only valid inside the callback it is handed to —
    // holding onto it and using it afterwards fails with "The script object
    // is no longer valid", so the removal happens in here too.
    ppro.TrackItemSelection.createEmptySelection((selection) => {
      for (const item of items) selection.addItem(item, true);
      project.lockedAccess(() => {
        project.executeTransaction((compoundAction) => {
          compoundAction.addAction(
            editor.createRemoveItemsAction(selection, false, mediaType, false),
          );
        }, label);
      });
    });
    cleared += items.length;
  }

  return cleared;
}

async function clearScratchTracks(project, log) {
  const cleared = await clearTrackItems(
    project,
    [
      { index: SCRATCH_VIDEO_TRACK, mediaType: ppro.Constants.MediaType.VIDEO },
      // Both channels: a stereo source on mono tracks occupies this one and the next.
      { index: SCRATCH_AUDIO_TRACK, mediaType: ppro.Constants.MediaType.AUDIO },
      { index: SCRATCH_AUDIO_TRACK + 1, mediaType: ppro.Constants.MediaType.AUDIO },
    ],
    "clear scratch track",
  );
  if (cleared > 0) log(`Cleared ${cleared} leftover item(s) from the scratch tracks`);
}

/**
 * Places every clip at its planned timeline position using an overwrite edit,
 * so a clip never ripples the ones already placed — the plan's
 * timelineStartSec values are absolute and must be honored exactly.
 *
 * A clip with a videoOverride is placed twice: its own source for the audio
 * (picture parked on the scratch video track) and the override's source for
 * the picture (audio parked on the scratch audio track).
 */
async function placeClips(project, sequence, plan, mediaByName, log) {
  const editor = ppro.SequenceEditor.getEditor(sequence);
  let usedScratch = false;

  for (let i = 0; i < plan.clips.length; i++) {
    const clip = plan.clips[i];
    const clipItem = mediaByName.get(clip.fileName);
    const at = clip.timelineStartSec;

    // The same ProjectItem gets re-trimmed per placement, which is why a clip
    // reused twice in one plan still lands with its own distinct range.
    setInOut(project, clipItem, clip.sourceInSec, clip.sourceOutSec, `set in/out for ${clip.fileName}`);

    if (!clip.videoOverride) {
      overwriteAt(project, editor, clipItem, at, 0, 0, `place ${clip.fileName} at ${at}s`);
      log(`Placed ${i + 1}/${plan.clips.length}: ${clip.fileName}`);
      continue;
    }

    // Audio from this moment's own clip; its picture goes to the scratch track.
    overwriteAt(project, editor, clipItem, at, SCRATCH_VIDEO_TRACK, 0, `place audio of ${clip.fileName} at ${at}s`);

    // Picture from the B-roll; its audio goes to the scratch track.
    const overrideItem = mediaByName.get(clip.videoOverride.fileName);
    setInOut(
      project,
      overrideItem,
      clip.videoOverride.sourceInSec,
      clip.videoOverride.sourceOutSec,
      `set in/out for ${clip.videoOverride.fileName}`,
    );
    overwriteAt(project, editor, overrideItem, at, 0, SCRATCH_AUDIO_TRACK, `place b-roll ${clip.videoOverride.fileName} at ${at}s`);

    usedScratch = true;
    log(`Placed ${i + 1}/${plan.clips.length}: ${clip.fileName} (picture from ${clip.videoOverride.fileName})`);
  }

  // Cleanup is cosmetic — the cut itself is already correct on V1/A1. A
  // failure here should leave the user with a usable sequence and a warning,
  // not throw away a good build.
  if (usedScratch) {
    try {
      await clearScratchTracks(project, log);
    } catch (err) {
      log(`Warning: could not clear the scratch tracks (${err.message}). Delete V${SCRATCH_VIDEO_TRACK + 1} and A${SCRATCH_AUDIO_TRACK + 1}+ by hand.`);
    }
  }
}

/**
 * Creates the sequence with settings taken from the footage itself, rather
 * than from whatever preset Premiere happens to default to.
 *
 * This matters more than it sounds: the default preset is landscape, so
 * vertical social footage was landing in a horizontal sequence with pillar
 * bars — the picture was correct and the frame was wrong. `createSequence`
 * takes no dimensions at all, so there was nothing to fix at the call site;
 * `createSequenceFromMedia` derives frame size, frame rate and pixel aspect
 * from a real clip.
 *
 * Two caveats handled here. The API wants ClipProjectItem, not the raw
 * ProjectItem that getItems() returns — the opposite of
 * createOverwriteItemAction, which rejects the cast (see CLAUDE.md). And it
 * seeds the new sequence with the media it was given, which would leave a
 * stray clip under the real cut, so V1/A1 are swept before anything is
 * placed. Falls back to the old behaviour rather than failing the build.
 */
async function createSequenceMatchingFootage(project, sequenceName, plan, mediaByName, log) {
  const formatSource = plan.clips[0]?.fileName;
  const item = formatSource ? mediaByName.get(formatSource) : null;

  if (item) {
    try {
      const clipItem = ppro.ClipProjectItem.cast(item);
      const created = await project.createSequenceFromMedia(sequenceName, [clipItem]);
      if (created) {
        log(`Created sequence "${sequenceName}" matched to ${formatSource}`);
        await project.openSequence(created);
        const seeded = await clearTrackItems(
          project,
          [
            { index: 0, mediaType: ppro.Constants.MediaType.VIDEO },
            { index: 0, mediaType: ppro.Constants.MediaType.AUDIO },
            { index: 1, mediaType: ppro.Constants.MediaType.AUDIO },
          ],
          "clear seeded media",
        );
        if (seeded > 0) log(`Cleared ${seeded} seeded item(s) from the new sequence`);
        return created;
      }
    } catch (err) {
      log(`Could not match the sequence to ${formatSource} (${err.message}); using Premiere's default preset instead.`);
    }
  }

  const created = await project.createSequence(sequenceName);
  if (!created) throw new Error("createSequence returned nothing");
  log(`Created sequence "${sequenceName}" with Premiere's default preset`);
  return created;
}

async function buildSequence(projectId, log) {
  const plan = await fetchPlan(projectId);
  log(`Plan: ${plan.clips.length} clips, ${plan.durationSec}s, ${plan.fps}fps`);

  const project = await ppro.Project.getActiveProject();
  if (!project) throw new Error("No project open in Premiere.");

  const mediaByName = await ensureMediaImported(project, plan, log);

  const sequenceName = `${plan.name} (Premier Edit)`;
  const created = await createSequenceMatchingFootage(
    project,
    sequenceName,
    plan,
    mediaByName,
    log,
  );

  // The editor writes to the sequence Premiere currently has open — Adobe's own
  // samples all edit getActiveSequence(). Placing into a freshly created but
  // unopened sequence fails with "Invalid parameter" on the first overwrite.
  await project.openSequence(created);
  const sequence = (await project.getActiveSequence()) ?? created;

  await placeClips(project, sequence, plan, mediaByName, log);

  return { sequenceName, clips: plan.clips.length };
}

module.exports = { buildSequence, fetchProjects, fetchPlan, APP_ORIGIN };
