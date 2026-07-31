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

module.exports = { fetchState, applyProfile, sendRefinement, applyDraft, discardDraft };
