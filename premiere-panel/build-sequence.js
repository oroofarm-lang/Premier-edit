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
  // The picture layer draws on shots the audio spine may never touch.
  for (const v of plan.videoLayer ?? []) {
    if (!byName.has(v.fileName)) missing.push(v.filePath);
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
  for (const v of plan.videoLayer ?? []) needed.add(v.fileName);
  for (const fileName of needed) {
    const item = byName.get(fileName);
    if (!item) {
      throw new Error(`Could not find ${fileName} in the project after import`);
    }
    resolved.set(fileName, item);
  }
  return resolved;
}

/** Scratch track indexes used to park the half of a placement we don't want.
 *
 * createOverwriteItemAction always places BOTH a clip's video and its audio —
 * there is no video-only or audio-only variant, and the UXP API has no Unlink
 * command either (verified against the whole @adobe/premierepro 26.3.0 .d.ts:
 * no unlink, no link, no setLinked anywhere). So the only way to end up with
 * one source's picture over another's sound is to send the unwanted halves to
 * tracks nobody reads, then sweep those tracks — the panel performing by hand
 * what a human would do with Unlink + Delete.
 *
 * The sweep below does NOT trust these indexes. It reads back what actually
 * landed on every track and clears everything outside the kept set, because
 * the one thing that cannot be assumed is how wide a placement lands: a stereo
 * source dropped into a sequence with mono tracks occupies TWO audio tracks.
 * A hardcoded scratch index of 1 once landed on the second channel of the real
 * audio and silently destroyed it — observed in Premiere, not theoretical.
 */
const SCRATCH_VIDEO_TRACK = 1;
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

/**
 * Removes every clip from the given tracks. Shared by the parked-media sweep
 * and by the sweep that empties a freshly created sequence, because the two
 * need identical, fiddly handling of Premiere's object lifetimes.
 *
 * Ripple is false throughout — removing these must not shift anything already
 * placed.
 *
 * **Every handle is re-fetched per track, and that is the whole point.** Each
 * removal is its own transaction, and a transaction invalidates the sequence,
 * editor and track objects that were read before it: calling into them again
 * fails with "The script object is no longer valid." An earlier version
 * fetched all of them once up front, so the first track cleared and the second
 * threw — which aborted the rest of the sweep and left the timeline holding
 * the parked halves the user then had to delete by hand.
 *
 * One track failing must not cost the others either, so each is attempted
 * independently and the failures are returned for the caller to report.
 */
async function clearTrackItems(project, trackSpecs, label) {
  let cleared = 0;
  const failures = [];

  for (const spec of trackSpecs) {
    try {
      const sequence = await project.getActiveSequence();
      if (!sequence) break;
      const editor = ppro.SequenceEditor.getEditor(sequence);

      const track =
        spec.mediaType === ppro.Constants.MediaType.VIDEO
          ? await sequence.getVideoTrack(spec.index)
          : await sequence.getAudioTrack(spec.index);
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
              editor.createRemoveItemsAction(selection, false, spec.mediaType, false),
            );
          }, label);
        });
      });
      cleared += items.length;
    } catch (err) {
      const name =
        spec.mediaType === ppro.Constants.MediaType.VIDEO
          ? `V${spec.index + 1}`
          : `A${spec.index + 1}`;
      failures.push(`${name} (${err.message})`);
    }
  }

  return { cleared, failures };
}

/**
 * Counts the clips sitting on every video and audio track right now.
 *
 * This is how the build learns where things actually landed instead of
 * assuming — which matters because a placement's width is not knowable in
 * advance (see the scratch-track note above). Everything after placement
 * (what to keep, what to sweep, what to report) is derived from this.
 */
async function trackCounts(project) {
  const sequence = await project.getActiveSequence();
  if (!sequence) return { video: [], audio: [] };

  const videoTotal = await sequence.getVideoTrackCount();
  const audioTotal = await sequence.getAudioTrackCount();

  const video = [];
  for (let i = 0; i < videoTotal; i++) {
    const track = await sequence.getVideoTrack(i);
    const items = track ? await track.getTrackItems(ppro.Constants.TrackItemType.CLIP, false) : [];
    video.push(items.length);
  }
  const audio = [];
  for (let i = 0; i < audioTotal; i++) {
    const track = await sequence.getAudioTrack(i);
    const items = track ? await track.getTrackItems(ppro.Constants.TrackItemType.CLIP, false) : [];
    audio.push(items.length);
  }
  return { video, audio };
}

/** The highest audio track index currently holding anything, or -1 if none. */
async function topOccupiedAudioTrack(project) {
  const counts = await trackCounts(project);
  let top = -1;
  counts.audio.forEach((n, i) => {
    if (n > 0) top = i;
  });
  return top;
}

/**
 * The audio tracks the finished cut is meant to keep: every occupied track
 * below the scratch band. Read back rather than assumed, so a spine that
 * landed two tracks wide keeps both channels and a spine that landed one
 * track wide doesn't protect an empty neighbour.
 */
function keptAudioTracks(counts, scratchAudioTrack) {
  const kept = new Set();
  for (let i = 0; i < Math.min(counts.audio.length, scratchAudioTrack); i++) {
    if (counts.audio[i] > 0) kept.add(i);
  }
  if (kept.size === 0) kept.add(0);
  return kept;
}

/**
 * Empties every track the cut does not use — all video above V1, and every
 * audio track outside the kept set. Ripple is false throughout: removing
 * these must not shift anything already placed.
 *
 * Sweeping by what is there beats sweeping fixed indexes. The previous version
 * cleared three hardcoded tracks, so a placement that landed anywhere else
 * survived the build and left the user with a timeline full of halves they
 * had to delete by hand.
 */
async function sweepToKeptTracks(project, keptAudio, log) {
  const counts = await trackCounts(project);
  const specs = [];

  for (let i = 1; i < counts.video.length; i++) {
    if (counts.video[i] > 0) {
      specs.push({ index: i, mediaType: ppro.Constants.MediaType.VIDEO });
    }
  }
  for (let i = 0; i < counts.audio.length; i++) {
    if (!keptAudio.has(i) && counts.audio[i] > 0) {
      specs.push({ index: i, mediaType: ppro.Constants.MediaType.AUDIO });
    }
  }
  if (specs.length === 0) return;

  const { cleared, failures } = await clearTrackItems(project, specs, "clear parked media");
  log(`Removed ${cleared} parked item(s) from ${specs.length} unused track(s)`);
  if (failures.length > 0) {
    log(`Could not clear ${failures.length} track(s): ${failures.join(", ")}`);
  }
}

/**
 * Reads the sequence back one last time and says what is really on it.
 *
 * Without this the build reported success from the fact that it issued the
 * right calls, which is not the same thing — the user found the leftovers
 * before the panel did.
 */
async function reportLayout(project, keptAudio, log) {
  const counts = await trackCounts(project);

  const kept = [`V1: ${counts.video[0] ?? 0} clip(s)`];
  for (const i of [...keptAudio].sort((a, b) => a - b)) {
    kept.push(`A${i + 1}: ${counts.audio[i] ?? 0} clip(s)`);
  }

  const leftovers = [];
  counts.video.forEach((n, i) => {
    if (i > 0 && n > 0) leftovers.push(`V${i + 1} (${n})`);
  });
  counts.audio.forEach((n, i) => {
    if (!keptAudio.has(i) && n > 0) leftovers.push(`A${i + 1} (${n})`);
  });

  log(`Final layout — ${kept.join(" · ")}`);
  if (leftovers.length > 0) {
    log(
      `Warning: parked media is still on ${leftovers.join(", ")}. Delete those ` +
        `tracks by hand. Premiere's UXP API has no Unlink command, so the panel ` +
        `places both halves of every clip and then removes the one it does not want.`,
    );
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

    log(`Placed ${i + 1}/${plan.clips.length}: ${clip.fileName} (picture from ${clip.videoOverride.fileName})`);
  }

  // The cut itself is already correct on V1/A1, so a failure here should leave
  // the user with a usable sequence and a warning rather than throw away a
  // good build — but it is not cosmetic. Leftover halves are exactly what made
  // a finished sequence unreadable: two pictures and two soundtracks per
  // moment, with no way to tell which one the cut actually meant.
  const keptAudio = keptAudioTracks(await trackCounts(project), SCRATCH_AUDIO_TRACK);
  try {
    await sweepToKeptTracks(project, keptAudio, log);
  } catch (err) {
    log(`Warning: could not clear the parked media (${err.message}).`);
  }
  await reportLayout(project, keptAudio, log);
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
        // Sweep every track, not the first few: the seed is one clip, and a
        // clip with four audio channels seeds four audio tracks. Clearing a
        // hardcoded V1/A1/A2 left the rest of it under the cut.
        const seedCounts = await trackCounts(project);
        const seedSpecs = [
          ...seedCounts.video.map((_, i) => ({ index: i, mediaType: ppro.Constants.MediaType.VIDEO })),
          ...seedCounts.audio.map((_, i) => ({ index: i, mediaType: ppro.Constants.MediaType.AUDIO })),
        ];
        const { cleared: seeded } = await clearTrackItems(project, seedSpecs, "clear seeded media");
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

/**
 * Builds the two-timeline cut: the audio spine on A1, and an independent
 * picture layer on V1 that changes on its own rhythm.
 *
 * Both layers are placed with the same park-the-unwanted-half trick the
 * B-roll path already proved. A spine clip is placed for its sound, with its
 * own picture parked on the scratch video track; a picture clip is placed
 * for its image, with its own sound parked on the scratch audio track —
 * unless the layout marked it as carrying a sound effect worth keeping, in
 * which case that audio lands on the track just above the spine instead.
 *
 * Every parked half is then swept, so what the user opens is a cut with one
 * picture and one soundtrack per moment rather than two of each. The sweep
 * decides what to remove from what it reads back off the tracks, not from
 * the indexes this function wrote to — see sweepToKeptTracks.
 */
async function placeTwoLayers(project, sequence, plan, mediaByName, log) {
  const editor = ppro.SequenceEditor.getEditor(sequence);

  for (const clip of plan.clips) {
    const item = mediaByName.get(clip.fileName);
    setInOut(project, item, clip.sourceInSec, clip.sourceOutSec, `set in/out for ${clip.fileName}`);
    overwriteAt(
      project, editor, item, clip.timelineStartSec,
      SCRATCH_VIDEO_TRACK, 0,
      `place spine audio ${clip.fileName} at ${clip.timelineStartSec}s`,
    );
  }
  log(`Placed the audio spine: ${plan.clips.length} moment(s)`);

  // How wide the spine's audio actually landed. A source with N audio channels
  // can occupy N tracks, so this is measured, never assumed — a guessed width
  // is what let parked audio survive the sweep and reach the user's timeline.
  const spineTop = await topOccupiedAudioTrack(project);

  // The picture layer goes down in two passes, keep-audio first. Doing the
  // keepers first means the scratch band can start above wherever their audio
  // actually ended up, instead of above a guess at how wide it would be —
  // which collides with the keepers as soon as the source has more than two
  // channels.
  const placeShot = (v, audioTrack) => {
    const item = mediaByName.get(v.fileName);
    setInOut(project, item, v.sourceInSec, v.sourceOutSec, `set in/out for ${v.fileName}`);
    overwriteAt(
      project, editor, item, v.timelineStartSec,
      0, audioTrack,
      `place picture ${v.fileName} at ${v.timelineStartSec}s`,
    );
  };

  // Shots carrying a sound effect worth hearing keep it just above the spine.
  const keepers = plan.videoLayer.filter((v) => v.useSourceAudio);
  for (const v of keepers) placeShot(v, spineTop + 1);

  // Everything the cut means to keep is now down, so anything above this line
  // is disposable.
  const scratchAudioTrack = (await topOccupiedAudioTrack(project)) + 1;

  // The rest carry dialogue the spine already says — park it and sweep it.
  for (const v of plan.videoLayer) {
    if (!v.useSourceAudio) placeShot(v, scratchAudioTrack);
  }

  log(
    `Placed the picture layer: ${plan.videoLayer.length} shot(s)` +
      (keepers.length > 0 ? `, ${keepers.length} keeping their own sound` : ""),
  );

  const keptAudio = keptAudioTracks(await trackCounts(project), scratchAudioTrack);
  try {
    await sweepToKeptTracks(project, keptAudio, log);
  } catch (err) {
    log(`Warning: could not clear the parked media (${err.message}).`);
  }
  await reportLayout(project, keptAudio, log);
}

/**
 * Builds the soundtrack and nothing else: the spine's audio on A1, its own
 * picture parked and swept, V1 left deliberately empty.
 *
 * This exists for judging a story rather than for delivering a cut. Picture is
 * the loudest thing in a sequence — a weak line reads as a boring shot, and a
 * strong one gets credit for the footage over it. Stripping the image is the
 * only way to hear whether the words hold up on their own, which is the
 * question the script layer is built to answer.
 */
async function placeAudioOnly(project, sequence, plan, mediaByName, log) {
  const editor = ppro.SequenceEditor.getEditor(sequence);

  for (const clip of plan.clips) {
    const item = mediaByName.get(clip.fileName);
    setInOut(project, item, clip.sourceInSec, clip.sourceOutSec, `set in/out for ${clip.fileName}`);
    overwriteAt(
      project, editor, item, clip.timelineStartSec,
      SCRATCH_VIDEO_TRACK, 0,
      `place audio ${clip.fileName} at ${clip.timelineStartSec}s`,
    );
  }
  log(`Placed the audio spine: ${plan.clips.length} moment(s), no picture`);

  // Everything occupied is spine audio — nothing else was placed — so the
  // scratch band starts immediately above it and the sweep takes the parked
  // picture off V2 with it.
  const keptAudio = keptAudioTracks(
    await trackCounts(project),
    (await topOccupiedAudioTrack(project)) + 1,
  );
  try {
    await sweepToKeptTracks(project, keptAudio, log);
  } catch (err) {
    log(`Warning: could not clear the parked media (${err.message}).`);
  }
  await reportLayout(project, keptAudio, log);
}

async function buildSequence(projectId, log, options = {}) {
  const audioOnly = options.audioOnly === true;
  const plan = await fetchPlan(projectId);
  const layerNote = audioOnly
    ? ", audio only"
    : plan.videoLayer?.length
      ? `, picture layer of ${plan.videoLayer.length} shot(s)`
      : "";
  log(`Plan: ${plan.clips.length} clips, ${plan.durationSec}s, ${plan.fps}fps${layerNote}`);

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

  const hasVideoLayer = Array.isArray(plan.videoLayer) && plan.videoLayer.length > 0;
  if (audioOnly) {
    await placeAudioOnly(project, sequence, plan, mediaByName, log);
  } else if (hasVideoLayer) {
    await placeTwoLayers(project, sequence, plan, mediaByName, log);
  } else {
    // No video-layout stage has run for this project, so each moment keeps
    // its own picture — exactly what every build did before two timelines.
    await placeClips(project, sequence, plan, mediaByName, log);
  }

  return {
    sequenceName,
    clips: plan.clips.length,
    videoClips: audioOnly || !hasVideoLayer ? 0 : plan.videoLayer.length,
    audioOnly,
  };
}

module.exports = { buildSequence, fetchProjects, fetchPlan, APP_ORIGIN };
