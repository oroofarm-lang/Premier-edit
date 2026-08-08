/**
 * Fetch helpers for the panel's cut/refinement view — pure HTTP, no
 * Premiere API calls (those live in build-sequence.js). Mirrors that file's
 * fetchPlan/fetchProjects shape: plain fetch against APP_ORIGIN, throw with
 * the HTTP status on failure.
 */

const { APP_ORIGIN } = require("./build-sequence");

async function fetchState(projectId) {
  const res = await fetch(`${APP_ORIGIN}/api/projects/${projectId}/state`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`State fetch failed (HTTP ${res.status}): ${body}`);
  }
  return res.json();
}

async function postJson(path, body) {
  const res = await fetch(`${APP_ORIGIN}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    let message = text;
    try {
      message = JSON.parse(text).error ?? text;
    } catch {
      // Not JSON — use the raw body as the message.
    }
    throw new Error(message);
  }
  return res.json();
}

function applyProfile(projectId, outputProfile) {
  return postJson(`/api/projects/${projectId}/profile`, { outputProfile });
}

function sendRefinement(projectId, instruction) {
  return postJson(`/api/projects/${projectId}/refine`, { instruction });
}

function applyDraft(projectId) {
  return postJson(`/api/projects/${projectId}/refine/apply`);
}

function discardDraft(projectId) {
  return postJson(`/api/projects/${projectId}/refine/discard`);
}

function generateAllProfiles(projectId) {
  return postJson(`/api/projects/${projectId}/generate-profiles`);
}

function createProject(fields) {
  return postJson("/api/projects", fields);
}

/** Starts a pipeline stage. Returns as soon as the server accepts it (202) —
 * the stage keeps running server-side and its progress arrives through
 * fetchState, so transcription's five minutes never block the panel. */
function startStage(projectId, stage) {
  return postJson(`/api/projects/${projectId}/${stage}`);
}

function approveStage(projectId, stage) {
  return postJson(`/api/projects/${projectId}/approve`, { stage });
}

function generateVideoLayer(projectId) {
  return postJson(`/api/projects/${projectId}/video-layout`);
}

module.exports = {
  fetchState,
  generateVideoLayer,
  applyProfile,
  sendRefinement,
  applyDraft,
  discardDraft,
  generateAllProfiles,
  createProject,
  startStage,
  approveStage,
};
