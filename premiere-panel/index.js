/**
 * Premier Edit — Stage 2 panel.
 *
 * Phase 1 (read-only): shows what Premiere currently has open, proving the
 * UXP connection works.
 * Phase 2 (execution): fetches an approved cut plan from the local Next.js
 * app and builds it into a new sequence, behind one confirmation.
 *
 * Design: docs/superpowers/specs/2026-07-30-stage2-live-panel-design.md
 */

const ppro = require("premierepro");
const { buildSequence, fetchProjects, fetchPlan, APP_ORIGIN } = require("./build-sequence");
const { fetchState, applyProfile, sendRefinement, applyDraft, discardDraft } = require("./state");

let loadedPlan = null;
let loadedProjectId = null;
// Separate from loadedProjectId above: this tracks which project's cut is
// currently displayed for viewing/refining, independent of whether its plan
// has been "Loaded" for the build flow.
let pickedProjectId = null;

const PROFILE_LABELS = {
  REEL_SHORT: "Reel / Short",
  SOCIAL_POST: "Social post",
  YOUTUBE_LONG: "YouTube long-form",
};
const DIFF_LABEL = { kept: "kept", removed: "removed", added: "added", moved: "moved" };

function setStatus(text, { loading = false, error = false } = {}) {
  document.getElementById("status-text").textContent = text;
  document.getElementById("status-spinner").hidden = !loading;
  document.getElementById("status").classList.toggle("error", error);
}

function log(text) {
  const li = document.createElement("li");
  li.textContent = text;
  document.getElementById("log").appendChild(li);
}

function showBlock(id, visible) {
  document.getElementById(id).hidden = !visible;
}

/** Phase 1: what does Premiere have open right now? */
async function refreshPremiereState() {
  const project = await ppro.Project.getActiveProject();
  if (!project) {
    document.getElementById("premiere-info").textContent = "No project open.";
    showBlock("premiere-block", true);
    return false;
  }

  const sequence = await project.getActiveSequence();
  const seqText = sequence
    ? `sequence "${sequence.name}"`
    : "no active sequence";
  document.getElementById("premiere-info").textContent =
    `${project.name} — ${seqText}`;
  showBlock("premiere-block", true);
  return true;
}

async function loadProjectList() {
  const picker = document.getElementById("project-picker");
  const options = document.getElementById("project-options");

  try {
    const projects = await fetchProjects();
    options.innerHTML = "";
    for (const project of projects) {
      const item = document.createElement("sp-menu-item");
      item.textContent = project.name;
      item.value = project.id;
      options.appendChild(item);
    }
    picker.placeholder =
      projects.length > 0 ? "Choose a project" : "No projects found";
  } catch (err) {
    picker.placeholder = "App not reachable";
    log(`Could not reach ${APP_ORIGIN} — is the app running? (${err.message})`);
  }
}

async function onLoadPlan() {
  const projectId = document.getElementById("project-picker").value;
  if (!projectId) {
    setStatus("Pick a project first.");
    return;
  }

  setStatus("Loading plan…", { loading: true });
  document.getElementById("build-button").disabled = true;

  try {
    const plan = await fetchPlan(projectId);
    loadedPlan = plan;
    loadedProjectId = projectId;

    document.getElementById("plan-summary").textContent =
      `${plan.clips.length} clips · ${plan.durationSec}s · ${plan.fps}fps · ${plan.width}×${plan.height}`;

    const list = document.getElementById("plan-list");
    list.innerHTML = "";
    for (const clip of plan.clips) {
      const li = document.createElement("li");
      li.textContent =
        `${clip.fileName}  ${clip.sourceInSec.toFixed(2)}→${clip.sourceOutSec.toFixed(2)}s` +
        `  @ ${clip.timelineStartSec.toFixed(2)}s`;
      list.appendChild(li);
    }

    showBlock("plan-block", true);

    const missing = plan.missingSources ?? [];
    const buildable = plan.clips.length > 0 && missing.length === 0;
    document.getElementById("build-button").disabled = !buildable;

    if (missing.length > 0) {
      setStatus(
        `${missing.length} source file(s) are missing from disk — cannot build.`,
        { error: true },
      );
      for (const filePath of missing) log(`Missing: ${filePath}`);
    } else {
      setStatus(
        plan.clips.length === 0
          ? "That project has no approved selections yet."
          : "Plan loaded. Review it, then Build sequence.",
      );
    }
  } catch (err) {
    setStatus(`Could not load plan: ${err.message}`, { error: true });
  }
}

async function onBuildClicked() {
  if (!loadedPlan) return;

  document.getElementById("confirm-text").textContent =
    `Build ${loadedPlan.clips.length} clips into a new sequence ` +
    `named "${loadedPlan.name} (Premier Edit)"?`;

  await document.getElementById("confirm-dialog").uxpShowModal({
    title: "Build sequence?",
    size: { width: 380, height: 260 },
  });
}

async function onConfirmed() {
  document.getElementById("confirm-dialog").close();
  document.getElementById("build-button").disabled = true;
  setStatus("Building…", { loading: true });

  try {
    const result = await buildSequence(loadedProjectId, log);
    setStatus(`Done — "${result.sequenceName}" with ${result.clips} clips.`);
    await refreshPremiereState();
  } catch (err) {
    setStatus(`Build failed: ${err.message}`, { error: true });
    log(`Error: ${err.message}`);
  } finally {
    document.getElementById("build-button").disabled = false;
  }
}

/** Any of the four mutating actions below (or picking a different project) can change what an already-loaded build plan would build — force an explicit re-"Load plan" rather than silently refreshing it. */
function clearLoadedPlan() {
  loadedPlan = null;
  loadedProjectId = null;
  showBlock("plan-block", false);
  document.getElementById("build-button").disabled = true;
}

function renderSelectionList(ulId, selections) {
  const ul = document.getElementById(ulId);
  ul.innerHTML = "";
  selections.forEach((s, i) => {
    const li = document.createElement("li");
    li.setAttribute("dir", "auto");
    let text = `${i + 1}. ${s.fileName}  ${s.startSec.toFixed(2)}–${s.endSec.toFixed(2)}s`;
    if (s.videoFileName) text += `  🎥 ${s.videoFileName}`;
    li.textContent = text;
    ul.appendChild(li);
  });
}

function renderProfileChips(state) {
  const container = document.getElementById("profile-chips");
  container.innerHTML = "";
  const previewByProfile = new Map(state.profilePreviews.map((p) => [p.outputProfile, p]));
  for (const profile of ["REEL_SHORT", "SOCIAL_POST", "YOUTUBE_LONG"]) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = PROFILE_LABELS[profile];
    const isActive = state.outputProfile === profile;
    const hasPreview = previewByProfile.has(profile);
    btn.className = "chip" + (isActive ? " active" : "");
    btn.disabled = isActive || !hasPreview;
    if (!isActive && hasPreview) {
      btn.addEventListener("click", () => onApplyProfile(profile));
    }
    container.appendChild(btn);
  }
}

function renderRefineChips(count) {
  const container = document.getElementById("refine-chips");
  container.innerHTML = "";
  for (let i = 1; i <= count; i++) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip";
    btn.textContent = String(i);
    btn.addEventListener("click", () => {
      const ta = document.getElementById("refine-input");
      const prefix = ta.value ? `${ta.value.trimEnd()} ` : "";
      ta.value = `${prefix}רגע ${i}: `;
      ta.focus();
    });
    container.appendChild(btn);
  }
}

function renderTurns(turns) {
  const ul = document.getElementById("refine-turns");
  ul.innerHTML = "";
  for (const t of turns) {
    const li = document.createElement("li");
    li.className = t.ok ? "turn-ok" : "turn-error";
    li.setAttribute("dir", "auto");
    li.textContent = `${t.ok ? "✓" : "✕"} ${t.instruction} — ${t.response}`;
    ul.appendChild(li);
  }
}

function renderDraft(draft) {
  const block = document.getElementById("draft-block");
  if (!draft) {
    block.hidden = true;
    return;
  }
  block.hidden = false;
  document.getElementById("draft-summary").textContent =
    `${draft.selections.length} moments · ${draft.totalDurationSec}s`;
  const premiseEl = document.getElementById("draft-premise");
  premiseEl.textContent = draft.premise ? `💡 ${draft.premise}` : "";
  premiseEl.hidden = !draft.premise;
  const ul = document.getElementById("draft-diff");
  ul.innerHTML = "";
  for (const d of draft.diff) {
    const li = document.createElement("li");
    li.className = `diff-${d.status}`;
    li.setAttribute("dir", "auto");
    li.textContent = `${DIFF_LABEL[d.status]} · ${d.fileName} · ${d.startSec}–${d.endSec}s`;
    ul.appendChild(li);
  }
}

/** Fetches and renders the active cut + refinement conversation for whichever project is picked. Hides both blocks if that project has no approved cut yet. */
async function loadState(projectId) {
  try {
    const state = await fetchState(projectId);

    if (state.selections.length === 0) {
      showBlock("cut-block", false);
      showBlock("refine-block", false);
      return;
    }

    showBlock("cut-block", true);
    renderProfileChips(state);
    document.getElementById("cut-premise").textContent = state.premise ? `💡 ${state.premise}` : "";
    renderSelectionList("cut-list", state.selections);

    if (!state.canRefine) {
      showBlock("refine-block", false);
      return;
    }
    showBlock("refine-block", true);
    renderRefineChips(state.selections.length);
    renderTurns(state.refinementDraft ? state.refinementDraft.turns : []);
    renderDraft(state.refinementDraft);
  } catch (err) {
    log(`Could not load cut state: ${err.message}`);
    showBlock("cut-block", false);
    showBlock("refine-block", false);
  }
}

async function onProjectSelected() {
  const projectId = document.getElementById("project-picker").value;
  clearLoadedPlan();
  pickedProjectId = projectId || null;
  if (!pickedProjectId) {
    showBlock("cut-block", false);
    showBlock("refine-block", false);
    return;
  }
  await loadState(pickedProjectId);
}

async function onApplyProfile(outputProfile) {
  if (!pickedProjectId) return;
  setStatus(`Switching to ${PROFILE_LABELS[outputProfile]}…`, { loading: true });
  try {
    await applyProfile(pickedProjectId, outputProfile);
    clearLoadedPlan();
    await loadState(pickedProjectId);
    setStatus(`Switched to ${PROFILE_LABELS[outputProfile]}.`);
  } catch (err) {
    setStatus(`Could not switch profile: ${err.message}`, { error: true });
  }
}

async function onSendRefinement() {
  const input = document.getElementById("refine-input");
  const instruction = input.value.trim();
  if (!instruction || !pickedProjectId) return;

  const sendButton = document.getElementById("refine-send-button");
  sendButton.disabled = true;
  setStatus("Refining…", { loading: true });
  try {
    await sendRefinement(pickedProjectId, instruction);
    input.value = "";
    await loadState(pickedProjectId);
    setStatus("Ready.");
  } catch (err) {
    setStatus(`Refinement failed: ${err.message}`, { error: true });
  } finally {
    sendButton.disabled = false;
  }
}

async function onApplyDraft() {
  if (!pickedProjectId) return;
  setStatus("Applying refinement…", { loading: true });
  try {
    await applyDraft(pickedProjectId);
    clearLoadedPlan();
    await loadState(pickedProjectId);
    setStatus("Applied.");
  } catch (err) {
    setStatus(`Could not apply: ${err.message}`, { error: true });
  }
}

async function onDiscardDraft() {
  if (!pickedProjectId) return;
  try {
    await discardDraft(pickedProjectId);
    await loadState(pickedProjectId);
  } catch (err) {
    setStatus(`Could not discard: ${err.message}`, { error: true });
  }
}

window.addEventListener("load", async () => {
  document
    .getElementById("load-plan-button")
    .addEventListener("click", onLoadPlan);
  document.getElementById("build-button").addEventListener("click", onBuildClicked);
  document.getElementById("confirm-ok").addEventListener("click", onConfirmed);
  document
    .getElementById("confirm-cancel")
    .addEventListener("click", () =>
      document.getElementById("confirm-dialog").close(),
    );

  document.getElementById("project-picker").addEventListener("change", onProjectSelected);
  document
    .getElementById("refine-send-button")
    .addEventListener("click", onSendRefinement);
  document.getElementById("draft-apply-button").addEventListener("click", onApplyDraft);
  document.getElementById("draft-discard-button").addEventListener("click", onDiscardDraft);
  document.getElementById("refine-input").addEventListener("keydown", (e) => {
    // Enter sends; Shift+Enter for a newline — same convention as the web app.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSendRefinement();
    }
  });

  const hasProject = await refreshPremiereState();
  await loadProjectList();
  setStatus(
    hasProject
      ? "Ready. Pick a project and load its plan."
      : "Open a project in Premiere to build into.",
  );
});
