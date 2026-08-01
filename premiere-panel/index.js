/**
 * Premier Edit — Stage 2 panel.
 *
 * Runs the whole pipeline from inside Premiere: create a project, ingest,
 * transcribe, select content, review and refine the cut, and build it into a
 * sequence. The browser app at localhost:3002 stays available but is no
 * longer required for any of it.
 *
 * Design: docs/superpowers/specs/2026-08-01-agents-and-panel-app-design.md
 */

const ppro = require("premierepro");
const uxpFs = require("uxp").storage.localFileSystem;
const { buildSequence, fetchProjects, fetchPlan, APP_ORIGIN } = require("./build-sequence");
const {
  fetchState,
  applyProfile,
  sendRefinement,
  applyDraft,
  discardDraft,
  generateAllProfiles,
  createProject,
  startStage,
  approveStage,
} = require("./state");

const PROFILE_LABELS = {
  REEL_SHORT: "Reel / Short",
  SOCIAL_POST: "Social post",
  YOUTUBE_LONG: "YouTube long-form",
};
const ALL_PROFILES = ["REEL_SHORT", "SOCIAL_POST", "YOUTUBE_LONG"];
const DIFF_LABEL = { kept: "kept", removed: "removed", added: "added", moved: "moved" };

/** Stage rows on the pipeline screen, in pipeline order. `approve` names the
 * PipelineStage enum member the approve route expects, or null where the
 * stage has no checkpoint of its own. */
const STAGES = [
  { key: "ingest", label: "Ingest", approve: "INGEST" },
  { key: "transcribe", label: "Transcribe", approve: "TRANSCRIPTION" },
  { key: "select", label: "Select content", approve: "CONTENT_SELECTION" },
];
const ALL_STAGE_KEYS = STAGES.map((s) => s.key);

let currentProjectId = null;
let currentProjectName = "";
let lastState = null;
let pollTimer = null;
/** Whether the previous refreshState saw a stage running, so the status line
 * can be cleared exactly once on the running→idle edge instead of being
 * rewritten every poll (which would stomp on "Building…"). */
let wasRunning = false;

// New-project form state that isn't held in an <input>.
let newProfile = "REEL_SHORT";
let newFootageFolder = null;
let newAudioFolder = null;

/* ------------------------------------------------------------- utilities */

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

function el(id) {
  return document.getElementById(id);
}

/** Sets both the property and the attribute. Spectrum's sp-button reflects
 * `disabled` itself, but the attribute is what CSS selectors match, so
 * setting only the property leaves styling out of sync. */
function setDisabled(element, disabled) {
  element.disabled = disabled;
  if (disabled) element.setAttribute("disabled", "");
  else element.removeAttribute("disabled");
}

/* --------------------------------------------------------------- routing */

const SCREENS = {
  home: {
    title: "Premier Edit",
    back: null,
    status: "Pick a project, or create one.",
  },
  new: {
    title: "New project",
    back: "home",
    status: "Choose a footage folder, then create.",
  },
  pipeline: {
    title: "Pipeline",
    back: "home",
    status: "Run each stage in order.",
  },
  cut: {
    title: "Cut review",
    back: "pipeline",
    status: "Review the cut, or refine it in words.",
  },
};

let currentScreen = "home";

function showScreen(name) {
  currentScreen = name;
  for (const key of Object.keys(SCREENS)) {
    el(`screen-${key}`).hidden = key !== name;
  }
  el("screen-title").textContent = SCREENS[name].title;
  el("back-button").hidden = SCREENS[name].back === null;
  el("screen-subtitle").textContent =
    name === "home" ? "" : currentProjectName;
  // Each screen owns its resting message, so a note left over from the
  // previous screen never sits there looking like current information.
  setStatus(SCREENS[name].status);
  // Only the pipeline screen shows live stage state, so polling is pointless
  // anywhere else.
  if (name === "pipeline") startPolling();
  else stopPolling();
}

function goBack() {
  const back = SCREENS[currentScreen].back;
  if (back) showScreen(back);
  if (back === "home") loadProjectList();
}

/* -------------------------------------------------------- Premiere state */

async function refreshPremiereState() {
  const project = await ppro.Project.getActiveProject();
  const card = el("premiere-card");
  if (!project) {
    el("premiere-info").textContent = "No project open.";
    card.hidden = false;
    return false;
  }
  const sequence = await project.getActiveSequence();
  el("premiere-info").textContent =
    `${project.name} — ${sequence ? `sequence "${sequence.name}"` : "no active sequence"}`;
  card.hidden = false;
  return true;
}

/* ------------------------------------------------------------------ home */

async function loadProjectList() {
  const container = el("project-cards");
  try {
    const projects = await fetchProjects();
    container.innerHTML = "";
    if (projects.length === 0) {
      const empty = document.createElement("div");
      empty.className = "meta";
      empty.textContent = "No projects yet — create one below.";
      container.appendChild(empty);
      return;
    }
    for (const project of projects) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "project-card";

      const name = document.createElement("div");
      name.className = "name";
      name.setAttribute("dir", "auto");
      name.textContent = project.name;

      const sub = document.createElement("div");
      sub.className = "sub";
      sub.textContent =
        `${PROFILE_LABELS[project.outputProfile] ?? project.outputProfile} · ` +
        `${project.assetCount} files · ${project.transcriptCount} transcribed · ` +
        `${project.momentCount} moments`;

      card.appendChild(name);
      card.appendChild(sub);
      card.addEventListener("click", () => openProject(project.id, project.name));
      container.appendChild(card);
    }
  } catch (err) {
    container.innerHTML = "";
    const failed = document.createElement("div");
    failed.className = "meta";
    failed.textContent = `Could not reach ${APP_ORIGIN} — is the app running?`;
    container.appendChild(failed);
    log(`Project list failed: ${err.message}`);
  }
}

async function openProject(projectId, name) {
  currentProjectId = projectId;
  currentProjectName = name;
  el("plan-block").hidden = true;
  showScreen("pipeline");
  await refreshState();
}

/* -------------------------------------------------------- new project */

function renderNewProfileChips() {
  const row = el("np-profile-chips");
  row.innerHTML = "";
  for (const profile of ALL_PROFILES) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip" + (profile === newProfile ? " active" : "");
    chip.textContent = PROFILE_LABELS[profile];
    chip.addEventListener("click", () => {
      newProfile = profile;
      renderNewProfileChips();
    });
    row.appendChild(chip);
  }
}

/** Opens Premiere's own folder picker. Returns the absolute path, or null if
 * the user cancelled — getFolder() resolves undefined on cancel rather than
 * rejecting. */
async function pickFolder() {
  const folder = await uxpFs.getFolder();
  return folder ? folder.nativePath : null;
}

function openNewProject() {
  newProfile = "REEL_SHORT";
  newFootageFolder = null;
  newAudioFolder = null;
  el("np-name").value = "";
  el("np-brief").value = "";
  el("np-footage-path").textContent = "Not chosen";
  el("np-footage-path").classList.add("muted");
  el("np-audio-path").textContent = "Not chosen";
  el("np-audio-path").classList.add("muted");
  renderNewProfileChips();
  currentProjectName = "";
  showScreen("new");
}

async function onPickFootage() {
  try {
    const path = await pickFolder();
    if (!path) return;
    newFootageFolder = path;
    el("np-footage-path").textContent = path;
    el("np-footage-path").classList.remove("muted");
  } catch (err) {
    setStatus(`Could not open the folder picker: ${err.message}`, { error: true });
  }
}

async function onPickAudio() {
  try {
    const path = await pickFolder();
    if (!path) return;
    newAudioFolder = path;
    el("np-audio-path").textContent = path;
    el("np-audio-path").classList.remove("muted");
  } catch (err) {
    setStatus(`Could not open the folder picker: ${err.message}`, { error: true });
  }
}

async function onCreateProject() {
  const name = el("np-name").value.trim();
  if (!name) {
    setStatus("Give the project a name first.", { error: true });
    return;
  }
  if (!newFootageFolder) {
    setStatus("Choose a footage folder first.", { error: true });
    return;
  }

  const button = el("np-create");
  setDisabled(button, true);
  setStatus("Creating project…", { loading: true });
  try {
    const result = await createProject({
      name,
      outputProfile: newProfile,
      footageFolder: newFootageFolder,
      audioFolder: newAudioFolder,
      brief: el("np-brief").value.trim(),
    });
    setStatus("Project created. Run Ingest to bring the footage in.");
    await openProject(result.project.id, result.project.name);
  } catch (err) {
    setStatus(`Could not create project: ${err.message}`, { error: true });
  } finally {
    setDisabled(button, false);
  }
}

/* -------------------------------------------------------------- pipeline */

function stageStatus(stage) {
  if (stage.job && stage.job.status === "running") return "running";
  if (stage.job && stage.job.status === "error") return "error";
  if (stage.approved) return "approved";
  if (stage.done) return "done";
  return "idle";
}

function renderStages(state) {
  const container = el("stage-rows");
  container.innerHTML = "";

  STAGES.forEach((definition, index) => {
    const stage = state.stages[definition.key];
    const status = stageStatus(stage);

    const row = document.createElement("div");
    row.className = "stage";

    const dot = document.createElement("div");
    dot.className = `stage-dot ${status}`;
    row.appendChild(dot);

    const main = document.createElement("div");
    main.className = "stage-main";
    const name = document.createElement("div");
    name.className = "stage-name";
    name.textContent = definition.label;
    const detail = document.createElement("div");
    detail.className = "stage-detail";
    detail.textContent =
      status === "error"
        ? stage.job.message
        : status === "running"
          ? "Running…"
          : status === "approved"
            ? `${stage.detail} · approved`
            : stage.detail;
    main.appendChild(name);
    main.appendChild(detail);
    row.appendChild(main);

    // A stage can only start once the one before it has produced something —
    // transcription with no media, or selection with no transcripts, just
    // fails in a way the user has to interpret.
    const previous = index === 0 ? null : state.stages[STAGES[index - 1].key];
    const ready = previous === null || previous.done;

    const action = document.createElement("div");
    if (status === "running") {
      const spinner = document.createElement("span");
      spinner.className = "spinner";
      action.appendChild(spinner);
    } else if (stage.done && definition.approve && !stage.approved) {
      action.appendChild(
        chipButton("Approve", () => onApproveStage(definition.approve)),
      );
    } else {
      const label = stage.done ? "Re-run" : "Run";
      const button = chipButton(label, () => onRunStage(definition.key));
      button.disabled = !ready;
      action.appendChild(button);
    }
    row.appendChild(action);

    container.appendChild(row);
  });
}

function chipButton(text, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "chip";
  button.textContent = text;
  button.addEventListener("click", onClick);
  return button;
}

async function onRunStage(stageKey) {
  if (!currentProjectId) return;
  setStatus(`Starting ${stageKey}…`, { loading: true });
  try {
    await startStage(currentProjectId, stageKey);
    // The stage runs server-side; polling reports when it lands.
    await refreshState();
    setStatus(`${stageKey} is running — this can take a few minutes.`, {
      loading: true,
    });
  } catch (err) {
    setStatus(`Could not start ${stageKey}: ${err.message}`, { error: true });
  }
}

async function onApproveStage(stage) {
  if (!currentProjectId) return;
  try {
    await approveStage(currentProjectId, stage);
    await refreshState();
    setStatus(`${stage} approved.`);
  } catch (err) {
    setStatus(`Could not approve: ${err.message}`, { error: true });
  }
}

/** Single read of everything the panel shows for the current project. Both
 * the pipeline and cut screens render from this one payload. */
async function refreshState() {
  if (!currentProjectId) return;
  try {
    const state = await fetchState(currentProjectId);
    lastState = state;
    currentProjectName = state.name ?? currentProjectName;
    if (currentScreen !== "home") {
      el("screen-subtitle").textContent = currentProjectName;
    }

    renderStages(state);

    const hasCut = state.selections.length > 0;
    setDisabled(el("open-cut-button"), !hasCut);
    setDisabled(el("build-button"), !hasCut);

    if (currentScreen === "cut") renderCutScreen(state);

    // Announce completion only on the transition, so a long-running build's
    // own status message isn't overwritten on every two-second poll.
    const running = ALL_STAGE_KEYS.some(
      (key) => state.stages[key].job && state.stages[key].job.status === "running",
    );
    const failed = ALL_STAGE_KEYS.filter(
      (key) => state.stages[key].job && state.stages[key].job.status === "error",
    );
    if (wasRunning && !running) {
      if (failed.length > 0) {
        const key = failed[0];
        setStatus(`${key} failed: ${state.stages[key].job.message}`, { error: true });
      } else {
        setStatus("Done.");
      }
    }
    wasRunning = running;
    return state;
  } catch (err) {
    setStatus(`Could not read project state: ${err.message}`, { error: true });
    return null;
  }
}

function startPolling() {
  stopPolling();
  // Keeps running even when nothing is in flight, so a stage started from the
  // web app still shows up here. One small local request every two seconds.
  pollTimer = setInterval(refreshState, 2000);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

/* ----------------------------------------------------------------- build */

async function onBuildClicked() {
  if (!currentProjectId) return;
  setStatus("Loading plan…", { loading: true });
  try {
    const plan = await fetchPlan(currentProjectId);

    el("plan-summary").textContent =
      `${plan.clips.length} clips · ${plan.durationSec}s · ${plan.fps}fps · ${plan.width}×${plan.height}`;
    const list = el("plan-list");
    list.innerHTML = "";
    for (const clip of plan.clips) {
      const li = document.createElement("li");
      li.setAttribute("dir", "auto");
      li.textContent =
        `${clip.fileName}  ${clip.sourceInSec.toFixed(2)}→${clip.sourceOutSec.toFixed(2)}s` +
        `  @ ${clip.timelineStartSec.toFixed(2)}s`;
      list.appendChild(li);
    }
    el("plan-block").hidden = false;

    const missing = plan.missingSources ?? [];
    if (missing.length > 0) {
      setStatus(
        `${missing.length} source file(s) are missing from disk — cannot build.`,
        { error: true },
      );
      for (const filePath of missing) log(`Missing: ${filePath}`);
      return;
    }
    if (plan.clips.length === 0) {
      setStatus("That project has no selected moments yet.", { error: true });
      return;
    }

    setStatus("Review the plan, then confirm.");
    el("confirm-text").textContent =
      `Build ${plan.clips.length} clips into a new sequence named "${plan.name} (Premier Edit)"?`;
    await el("confirm-dialog").uxpShowModal({
      title: "Build sequence?",
      size: { width: 380, height: 260 },
    });
  } catch (err) {
    setStatus(`Could not load plan: ${err.message}`, { error: true });
  }
}

async function onConfirmed() {
  el("confirm-dialog").close();
  setDisabled(el("build-button"), true);
  setStatus("Building…", { loading: true });
  try {
    const result = await buildSequence(currentProjectId, log);
    setStatus(`Done — "${result.sequenceName}" with ${result.clips} clips.`);
    await refreshPremiereState();
  } catch (err) {
    setStatus(`Build failed: ${err.message}`, { error: true });
    log(`Error: ${err.message}`);
  } finally {
    setDisabled(el("build-button"), false);
  }
}

/* ------------------------------------------------------------ cut review */

function renderSelectionList(ulId, selections) {
  const ul = el(ulId);
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

function renderNotChosen(notChosen) {
  const details = el("not-chosen-details");
  if (!notChosen || notChosen.length === 0) {
    details.hidden = true;
    return;
  }
  details.hidden = false;
  details.open = false;
  el("not-chosen-summary").textContent =
    `עוד ${notChosen.length} רגעים שנשקלו ולא נבחרו`;
  const ul = el("not-chosen-list");
  ul.innerHTML = "";
  for (const c of notChosen) {
    const li = document.createElement("li");
    li.setAttribute("dir", "auto");
    const parts = [`${c.fileName} · ${c.startSec.toFixed(2)}–${c.endSec.toFixed(2)}s`];
    if (c.text) parts.push(c.text);
    if (c.visualSummary) parts.push(`👁 ${c.visualSummary}`);
    li.textContent = parts.join(" — ");
    ul.appendChild(li);
  }
}

function renderProfileChips(state) {
  const container = el("profile-chips");
  container.innerHTML = "";
  const previewByProfile = new Map(state.profilePreviews.map((p) => [p.outputProfile, p]));
  for (const profile of ALL_PROFILES) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.textContent = PROFILE_LABELS[profile];
    const isActive = state.outputProfile === profile;
    const hasPreview = previewByProfile.has(profile);
    chip.className = "chip" + (isActive ? " active" : "");
    chip.disabled = isActive || !hasPreview;
    if (!isActive && hasPreview) {
      chip.addEventListener("click", () => onApplyProfile(profile));
    }
    container.appendChild(chip);
  }
}

function renderRefineChips(count) {
  const container = el("refine-chips");
  container.innerHTML = "";
  for (let i = 1; i <= count; i++) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.textContent = String(i);
    chip.addEventListener("click", () => {
      const ta = el("refine-input");
      const prefix = ta.value ? `${ta.value.trimEnd()} ` : "";
      ta.value = `${prefix}רגע ${i}: `;
      ta.focus();
    });
    container.appendChild(chip);
  }
}

function renderTurns(turns) {
  const ul = el("refine-turns");
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
  const block = el("draft-block");
  if (!draft) {
    block.hidden = true;
    return;
  }
  block.hidden = false;
  el("draft-summary").textContent =
    `${draft.selections.length} moments · ${draft.totalDurationSec}s` +
    (draft.premise ? ` · ${draft.premise}` : "");
  const ul = el("draft-diff");
  ul.innerHTML = "";
  for (const d of draft.diff) {
    const li = document.createElement("li");
    li.className = `diff-${d.status}`;
    li.setAttribute("dir", "auto");
    li.textContent = `${DIFF_LABEL[d.status]} · ${d.fileName} · ${d.startSec}–${d.endSec}s`;
    ul.appendChild(li);
  }
}

function renderCutScreen(state) {
  renderProfileChips(state);
  el("cut-premise").textContent = state.premise ? `💡 ${state.premise}` : "";
  const beatPlan = state.beatPlan ?? [];
  el("cut-beatplan").textContent =
    beatPlan.length > 0 ? `מבנה: ${beatPlan.join(" ← ")}` : "";
  renderSelectionList("cut-list", state.selections);
  renderNotChosen(state.notChosen);

  const refine = el("refine-block");
  if (!state.canRefine) {
    refine.hidden = true;
    return;
  }
  refine.hidden = false;
  renderRefineChips(state.selections.length);
  renderTurns(state.refinementDraft ? state.refinementDraft.turns : []);
  renderDraft(state.refinementDraft);
}

function openCutScreen() {
  showScreen("cut");
  if (lastState) renderCutScreen(lastState);
}

/* ------------------------------------------------- cut-screen actions */

async function onApplyProfile(outputProfile) {
  if (!currentProjectId) return;
  setStatus(`Switching to ${PROFILE_LABELS[outputProfile]}…`, { loading: true });
  try {
    await applyProfile(currentProjectId, outputProfile);
    el("plan-block").hidden = true;
    const state = await refreshState();
    if (state) renderCutScreen(state);
    setStatus(`Switched to ${PROFILE_LABELS[outputProfile]}.`);
  } catch (err) {
    setStatus(`Could not switch profile: ${err.message}`, { error: true });
  }
}

async function onGenerateAllProfiles() {
  if (!currentProjectId) return;
  const button = el("generate-profiles-button");
  setDisabled(button, true);
  setStatus("Generating all 3 profiles — several model calls, can take a minute.", {
    loading: true,
  });
  try {
    await generateAllProfiles(currentProjectId);
    const state = await refreshState();
    if (state) renderCutScreen(state);
    setStatus("Ready.");
  } catch (err) {
    setStatus(`Could not generate profiles: ${err.message}`, { error: true });
  } finally {
    setDisabled(button, false);
  }
}

async function onSendRefinement() {
  const input = el("refine-input");
  const instruction = input.value.trim();
  if (!instruction || !currentProjectId) return;

  const button = el("refine-send-button");
  setDisabled(button, true);
  setStatus("Refining…", { loading: true });
  try {
    await sendRefinement(currentProjectId, instruction);
    input.value = "";
    const state = await refreshState();
    if (state) renderCutScreen(state);
    setStatus("Ready.");
  } catch (err) {
    setStatus(`Refinement failed: ${err.message}`, { error: true });
  } finally {
    setDisabled(button, false);
  }
}

async function onApplyDraft() {
  if (!currentProjectId) return;
  setStatus("Applying refinement…", { loading: true });
  try {
    await applyDraft(currentProjectId);
    el("plan-block").hidden = true;
    const state = await refreshState();
    if (state) renderCutScreen(state);
    setStatus("Applied.");
  } catch (err) {
    setStatus(`Could not apply: ${err.message}`, { error: true });
  }
}

async function onDiscardDraft() {
  if (!currentProjectId) return;
  try {
    await discardDraft(currentProjectId);
    const state = await refreshState();
    if (state) renderCutScreen(state);
  } catch (err) {
    setStatus(`Could not discard: ${err.message}`, { error: true });
  }
}

/* ------------------------------------------------------------------ init */

window.addEventListener("load", async () => {
  el("back-button").addEventListener("click", goBack);
  el("refresh-projects").addEventListener("click", loadProjectList);
  el("new-project-button").addEventListener("click", openNewProject);

  el("np-footage-pick").addEventListener("click", onPickFootage);
  el("np-audio-pick").addEventListener("click", onPickAudio);
  el("np-create").addEventListener("click", onCreateProject);

  el("open-cut-button").addEventListener("click", openCutScreen);
  el("build-button").addEventListener("click", onBuildClicked);
  el("confirm-ok").addEventListener("click", onConfirmed);
  el("confirm-cancel").addEventListener("click", () =>
    el("confirm-dialog").close(),
  );

  el("generate-profiles-button").addEventListener("click", onGenerateAllProfiles);
  el("refine-send-button").addEventListener("click", onSendRefinement);
  el("draft-apply-button").addEventListener("click", onApplyDraft);
  el("draft-discard-button").addEventListener("click", onDiscardDraft);
  el("refine-input").addEventListener("keydown", (e) => {
    // Enter sends; Shift+Enter for a newline — same convention as the web app.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSendRefinement();
    }
  });

  showScreen("home");
  const hasProject = await refreshPremiereState();
  await loadProjectList();
  setStatus(
    hasProject
      ? "Ready. Pick a project, or create one."
      : "Open a project in Premiere to build into.",
  );
});
