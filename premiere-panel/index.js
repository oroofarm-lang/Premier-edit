/**
 * Premier Edit — Stage 2 panel, walking skeleton.
 *
 * Confirms the UXP <-> Premiere connection is real by reading the active
 * project, active sequence, and video track 1's clips straight from the
 * Premiere DOM. No writes yet — this is Phase 1 of the Stage 2 panel
 * (docs/superpowers/specs/2026-07-30-stage2-live-panel-design.md):
 * read-only first, plan execution comes in a later phase.
 */

const ppro = require("premierepro");

function setStatus(text) {
  document.getElementById("status").textContent = text;
}

function showBlock(id, visible) {
  document.getElementById(id).hidden = !visible;
}

async function listVideoTrackOneClips(sequence) {
  const listEl = document.getElementById("clip-list");
  listEl.innerHTML = "";

  const trackCount = await sequence.getVideoTrackCount();
  if (trackCount === 0) {
    const li = document.createElement("li");
    li.textContent = "(no video tracks)";
    listEl.appendChild(li);
    return;
  }

  const track = await sequence.getVideoTrack(0);
  const items = track.getTrackItems(ppro.Constants.TrackItemType.CLIP, false);

  if (items.length === 0) {
    const li = document.createElement("li");
    li.textContent = "(video track 1 is empty)";
    listEl.appendChild(li);
    return;
  }

  for (const item of items) {
    const start = await item.getStartTime();
    const end = await item.getEndTime();
    const li = document.createElement("li");
    li.textContent = `${item.name}  —  ${start.seconds.toFixed(2)}s to ${end.seconds.toFixed(2)}s`;
    listEl.appendChild(li);
  }
}

async function refresh() {
  setStatus("Reading active project…");
  showBlock("project-block", false);
  showBlock("sequence-block", false);
  showBlock("clips-block", false);

  let project;
  try {
    project = await ppro.Project.getActiveProject();
  } catch (err) {
    setStatus(`Error reading project: ${err}`);
    return;
  }

  if (!project) {
    setStatus("No project open in Premiere.");
    return;
  }

  document.getElementById("project-name").textContent = project.name;
  showBlock("project-block", true);

  const sequence = await project.getActiveSequence();
  if (!sequence) {
    setStatus("Project open, but no active sequence.");
    return;
  }

  document.getElementById("sequence-name").textContent = sequence.name;
  showBlock("sequence-block", true);

  await listVideoTrackOneClips(sequence);
  showBlock("clips-block", true);

  setStatus("Connected.");
}

window.addEventListener("load", async () => {
  document.getElementById("refresh-button").addEventListener("click", refresh);
  await refresh();
});
