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

let loadedPlan = null;
let loadedProjectId = null;

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

  const hasProject = await refreshPremiereState();
  await loadProjectList();
  setStatus(
    hasProject
      ? "Ready. Pick a project and load its plan."
      : "Open a project in Premiere to build into.",
  );
});
