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
const SCRATCH_VIDEO_TRACK = 1;
const SCRATCH_AUDIO_TRACK = 1;

/** Trims a project item to an in/out range, so the following overwrite edit
 * inserts exactly the chosen moment rather than the whole file. */
function setInOut(project, clipItem, inSec, outSec, label) {
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
}

function overwriteAt(project, editor, clipItem, atSec, videoTrack, audioTrack, label) {
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
}

/** Empties the scratch tracks left behind by B-roll placements. Ripple is
 * false throughout — removing these must not shift anything already placed. */
async function clearScratchTracks(project, sequence, editor, log) {
  const passes = [
    { track: await sequence.getVideoTrack(SCRATCH_VIDEO_TRACK), mediaType: ppro.Constants.MediaType.VIDEO },
    { track: await sequence.getAudioTrack(SCRATCH_AUDIO_TRACK), mediaType: ppro.Constants.MediaType.AUDIO },
  ];

  for (const { track, mediaType } of passes) {
    if (!track) continue;
    const items = await track.getTrackItems(ppro.Constants.TrackItemType.CLIP, false);
    if (items.length === 0) continue;

    let selection;
    ppro.TrackItemSelection.createEmptySelection((s) => {
      selection = s;
    });
    for (const item of items) selection.addItem(item, true);

    project.lockedAccess(() => {
      project.executeTransaction((compoundAction) => {
        compoundAction.addAction(
          editor.createRemoveItemsAction(selection, false, mediaType, false),
        );
      }, "clear scratch track");
    });
    log(`Cleared ${items.length} leftover item(s) from a scratch track`);
  }
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
    const clipItem = ppro.ClipProjectItem.cast(mediaByName.get(clip.fileName));
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
    const overrideItem = ppro.ClipProjectItem.cast(mediaByName.get(clip.videoOverride.fileName));
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

  if (usedScratch) await clearScratchTracks(project, sequence, editor, log);
}

async function buildSequence(projectId, log) {
  const plan = await fetchPlan(projectId);
  log(`Plan: ${plan.clips.length} clips, ${plan.durationSec}s, ${plan.fps}fps`);

  const project = await ppro.Project.getActiveProject();
  if (!project) throw new Error("No project open in Premiere.");

  const mediaByName = await ensureMediaImported(project, plan, log);

  const sequenceName = `${plan.name} (Premier Edit)`;
  const sequence = await project.createSequence(sequenceName);
  if (!sequence) throw new Error("createSequence returned nothing");
  log(`Created sequence "${sequenceName}"`);

  await placeClips(project, sequence, plan, mediaByName, log);
  await project.openSequence(sequence);

  return { sequenceName, clips: plan.clips.length };
}

module.exports = { buildSequence, fetchProjects, fetchPlan, APP_ORIGIN };
