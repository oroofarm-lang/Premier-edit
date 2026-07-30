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
  for (const clip of plan.clips) {
    const item = byName.get(clip.fileName);
    if (!item) {
      throw new Error(`Could not find ${clip.fileName} in the project after import`);
    }
    resolved.set(clip.fileName, item);
  }
  return resolved;
}

/**
 * Places every clip on V1/A1 at its planned timeline position using an
 * overwrite edit, so a clip never ripples the ones already placed — the
 * plan's timelineStartSec values are absolute and must be honored exactly.
 */
async function placeClips(project, sequence, plan, mediaByName, log) {
  const editor = ppro.SequenceEditor.getEditor(sequence);

  for (let i = 0; i < plan.clips.length; i++) {
    const clip = plan.clips[i];
    const clipItem = ppro.ClipProjectItem.cast(mediaByName.get(clip.fileName));

    // Trim the source to the planned in/out first, so the overwrite edit
    // inserts exactly the chosen moment rather than the whole file. The same
    // ProjectItem gets re-trimmed per placement, which is why a clip reused
    // twice in one plan still lands with its own distinct range.
    project.lockedAccess(() => {
      project.executeTransaction((compoundAction) => {
        compoundAction.addAction(
          clipItem.createSetInOutPointsAction(
            ppro.TickTime.createWithSeconds(clip.sourceInSec),
            ppro.TickTime.createWithSeconds(clip.sourceOutSec),
          ),
        );
      }, `set in/out for ${clip.fileName}`);
    });

    project.lockedAccess(() => {
      project.executeTransaction((compoundAction) => {
        compoundAction.addAction(
          editor.createOverwriteItemAction(
            clipItem,
            ppro.TickTime.createWithSeconds(clip.timelineStartSec),
            0,
            0,
          ),
        );
      }, `place ${clip.fileName} at ${clip.timelineStartSec}s`);
    });

    log(`Placed ${i + 1}/${plan.clips.length}: ${clip.fileName}`);
  }
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
