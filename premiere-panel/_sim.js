/**
 * SIM ONLY — a fake Premiere, just complete enough to run build-sequence.js
 * outside UXP and assert what ends up on which track. Not shipped; the
 * underscore prefix matches _stub.js, which does the same job for the
 * panel's markup (via `npm run panel:preview`).
 *
 * Why this exists: build-sequence.js does `require("premierepro")` at the top,
 * so it only runs inside Premiere, and this project's standing rule is that
 * the real Premiere check is the user's own step. That left the build's track
 * arithmetic completely untested — and it was wrong twice in ways the user
 * discovered by finding junk on their timeline. This models the two Premiere
 * behaviours that actually broke it:
 *
 *   1. An overwrite edit places BOTH halves of a clip, and a source with N
 *      audio channels can occupy N audio tracks, not one. A sweep that clears
 *      fixed track indexes therefore misses whatever landed elsewhere.
 *   2. A transaction invalidates script objects read before it. Handles
 *      gathered up front go stale mid-sweep, and the throw aborts the rest of
 *      the cleanup.
 *
 * It does NOT model Premiere's real semantics for linked clips, undo, or
 * anything visual. Passing here means the bookkeeping is right, not that the
 * build looks correct in Premiere. That check remains the user's.
 *
 * Run: npm run panel:sim
 */
const Module = require("node:module");
const assert = require("node:assert");
const path = require("node:path");

const MediaType = { ANY: 0, DATA: 1, VIDEO: 2, AUDIO: 3 };
const TrackItemType = { CLIP: 1 };

const TARGET = path.join(__dirname, "build-sequence.js");

let nextId = 1;

/** Models Premiere invalidating a script object once the timeline changes. */
function checkAlive(state, born) {
  if (state.strict && born !== state.generation) {
    throw new Error("The script object is no longer valid.");
  }
}

function makeSequence(audioChannelsPerClip) {
  return { videoTracks: [[]], audioTracks: [[]], audioChannelsPerClip, name: "seq" };
}

function track(list, index) {
  while (list.length <= index) list.push([]);
  return list[index];
}

/**
 * An AudioClipTrackItem as build-sequence.js uses it: a component chain whose
 * volume component reports a unity value, and a level param that records the
 * keyframes written to it so the test can assert the ramp shape.
 *
 * `state.levelUnity` chooses what an untouched clip reads — 0 for decibels,
 * 1 for a normalised scale, or something else entirely to check that the code
 * refuses to guess.
 */
function audioItemApi(state, item) {
  const param = {
    async getValueAtTime() { return state.levelUnity; },
    createKeyframe(value) { return { value, position: null }; },
    createSetTimeVaryingAction() { return () => { item.timeVarying = true; }; },
    createAddKeyframeAction(keyframe) {
      return () => {
        item.keyframes = item.keyframes ?? [];
        item.keyframes.push({ atSec: keyframe.position.sec, value: keyframe.value });
      };
    },
  };
  const volume = {
    async getMatchName() { return state.volumeMatchName; },
    async getDisplayName() { return "Volume"; },
    getParamCount() { return 2; },
    // Param 0 is Bypass (boolean) — the code must skip it and take param 1.
    getParam(i) { return i === 0 ? { async getValueAtTime() { return false; } } : param; },
  };
  const other = {
    async getMatchName() { return "AE.ADBE Audio Panner"; },
    async getDisplayName() { return "Panner"; },
    getParamCount() { return 1; },
    getParam() { return { async getValueAtTime() { return 0.5; } }; },
  };
  return {
    _raw: item,
    async getStartTime() { return { seconds: item.at }; },
    async getEndTime() { return { seconds: item.at + item.durationSec }; },
    async getComponentChain() {
      const parts = state.volumeMatchName === null ? [other] : [other, volume];
      return {
        getComponentCount() { return parts.length; },
        getComponentAtIndex(i) { return parts[i]; },
      };
    },
  };
}

function makeApi(state) {
  const seqApi = (seq) => ({
    async getVideoTrackCount() { return seq.videoTracks.length; },
    async getAudioTrackCount() { return seq.audioTracks.length; },
    async getVideoTrack(i) {
      if (i >= seq.videoTracks.length) return null;
      const born = state.generation;
      return { async getTrackItems() { checkAlive(state, born); return seq.videoTracks[i].slice(); } };
    },
    async getAudioTrack(i) {
      if (i >= seq.audioTracks.length) return null;
      const born = state.generation;
      return {
        async getTrackItems() {
          checkAlive(state, born);
          return seq.audioTracks[i].map((item) => audioItemApi(state, item));
        },
      };
    },
    _raw: seq,
  });

  const editorFor = (seq) => ({
    createOverwriteItemAction(projectItem, time, videoTrackIndex, audioTrackIndex) {
      return () => {
        track(seq.videoTracks, videoTrackIndex).push({
          id: nextId++, mediaType: MediaType.VIDEO, name: projectItem.name, at: time.sec,
        });
        // The whole point: one clip, N audio tracks.
        for (let c = 0; c < seq.audioChannelsPerClip; c++) {
          track(seq.audioTracks, audioTrackIndex + c).push({
            id: nextId++, mediaType: MediaType.AUDIO, name: projectItem.name, at: time.sec,
            durationSec: (projectItem.outSec ?? 2) - (projectItem.inSec ?? 0),
          });
        }
      };
    },
    createRemoveItemsAction(selection, _ripple, mediaType) {
      return () => {
        const ids = new Set(
          selection._items
            .map((i) => i._raw ?? i)
            .filter((i) => i.mediaType === mediaType)
            .map((i) => i.id),
        );
        for (const list of [seq.videoTracks, seq.audioTracks]) {
          for (let i = 0; i < list.length; i++) {
            list[i] = list[i].filter((item) => !ids.has(item.id));
          }
        }
        state.generation++; // outstanding handles are now stale
      };
    },
  });

  return {
    Constants: { MediaType, TrackItemType },
    TickTime: { createWithSeconds: (sec) => ({ sec }) },
    ClipProjectItem: {
      cast: (item) => ({
        ...item,
        createSetInOutPointsAction: (a, b) => () => { item.inSec = a.sec; item.outSec = b.sec; },
      }),
    },
    SequenceEditor: { getEditor: (seq) => editorFor(seq._raw ?? seq) },
    TrackItemSelection: {
      createEmptySelection(cb) {
        cb({ _items: [], addItem(item) { this._items.push(item); return true; } });
        return true;
      },
    },
    Project: { async getActiveProject() { return state.project; } },
    _seqApi: seqApi,
  };
}

function makeProject(state, ppro) {
  const items = [];
  return {
    async getRootItem() {
      return { async getItems() { return items.slice(); } };
    },
    async importFiles(paths) {
      for (const p of paths) items.push({ name: p.split("/").pop(), path: p });
      return true;
    },
    async createSequenceFromMedia(_name, [clipItem]) {
      const seq = makeSequence(state.audioChannelsPerClip);
      // Seeded with the media it was handed — both halves, like the real API.
      seq.videoTracks[0].push({ id: nextId++, mediaType: MediaType.VIDEO, name: clipItem.name, at: 0 });
      for (let c = 0; c < seq.audioChannelsPerClip; c++) {
        track(seq.audioTracks, c).push({ id: nextId++, mediaType: MediaType.AUDIO, name: clipItem.name, at: 0 });
      }
      state.sequence = seq;
      return ppro._seqApi(seq);
    },
    async createSequence() {
      state.sequence = makeSequence(state.audioChannelsPerClip);
      return ppro._seqApi(state.sequence);
    },
    async openSequence() { return true; },
    async getActiveSequence() {
      return state.sequence ? ppro._seqApi(state.sequence) : null;
    },
    lockedAccess(fn) { return fn(); },
    executeTransaction(fn) {
      const actions = [];
      fn({ addAction: (a) => actions.push(a) });
      for (const a of actions) a();
      return true;
    },
  };
}

function loadBuildSequence(ppro) {
  const resolved = require.resolve(TARGET);
  delete require.cache[resolved];
  const original = Module._load;
  Module._load = function (request, ...rest) {
    if (request === "premierepro") return ppro;
    return original.call(this, request, ...rest);
  };
  try {
    return require(resolved);
  } finally {
    Module._load = original;
  }
}

const failures = [];

async function run({
  label, plan, audioChannels, expectAudioTracks, strict, verbose,
  levelUnity = 0, volumeMatchName = "AE.ADBE Audio Levels", expectFades = true,
}) {
  const state = {
    audioChannelsPerClip: audioChannels,
    sequence: null,
    generation: 0,
    strict,
    levelUnity,
    volumeMatchName,
  };
  const ppro = makeApi(state);
  state.project = makeProject(state, ppro);

  globalThis.fetch = async (url) => {
    if (url.endsWith("/timeline")) return { ok: true, json: async () => plan };
    throw new Error(`unexpected fetch ${url}`);
  };

  const lines = [];
  const { buildSequence } = loadBuildSequence(ppro);
  await buildSequence("p1", (t) => lines.push(t));

  const seq = state.sequence;
  const video = seq.videoTracks.map((t) => t.length);
  const audio = seq.audioTracks.map((t) => t.length);
  const occupiedAudio = audio.map((n, i) => (n > 0 ? i : -1)).filter((i) => i >= 0);
  const strayVideo = video.slice(1).reduce((a, b) => a + b, 0);

  const name = `${label} · ${audioChannels}-channel · ${strict ? "strict" : "lax"} lifetimes`;
  let problem = null;
  let fadeNote = "fades not reached";
  try {
    assert.strictEqual(strayVideo, 0, `${strayVideo} parked picture item(s) left above V1`);
    assert.deepStrictEqual(
      occupiedAudio, expectAudioTracks,
      `audio on ${JSON.stringify(occupiedAudio)}, expected ${JSON.stringify(expectAudioTracks)}`,
    );
    assert.ok(video[0] > 0, "V1 is empty");

    // Every surviving audio clip long enough to take a ramp should carry one:
    // four keyframes, quiet-full-full-quiet, in the clip's own time domain.
    const fadeable = seq.audioTracks.flat().filter((i) => (i.durationSec ?? 0) >= 0.2);
    const faded = fadeable.filter((i) => (i.keyframes ?? []).length > 0);
    assert.ok(fadeable.length > 0, "no audio clip was long enough to fade — check the fixture");

    if (expectFades) {
      assert.strictEqual(
        faded.length, fadeable.length,
        `${fadeable.length - faded.length} of ${fadeable.length} audio clip(s) got no fade`,
      );
      for (const item of faded) {
        const kf = item.keyframes;
        assert.strictEqual(kf.length, 4, `expected 4 keyframes, got ${kf.length}`);
        assert.strictEqual(kf[0].atSec, 0, "ramp must start at the clip's own start");
        assert.ok(
          Math.abs(kf[3].atSec - item.durationSec) < 1e-9,
          `ramp must end at the clip's end (${kf[3].atSec} vs ${item.durationSec})`,
        );
        assert.ok(kf[0].value < kf[1].value, "must rise into the clip");
        assert.ok(kf[3].value < kf[2].value, "must fall out of the clip");
        assert.strictEqual(kf[1].value, kf[2].value, "must hold unity in between");
        assert.strictEqual(item.timeVarying, true, "param must be set time-varying");
      }
    } else {
      assert.strictEqual(
        faded.length, 0,
        `expected no fades, but ${faded.length} clip(s) were written to`,
      );
    }
    fadeNote = expectFades ? `${faded.length} faded` : "no fades (as expected)";
  } catch (err) {
    problem = err.message;
    failures.push(`${name}: ${problem}`);
  }

  console.log(`${problem ? "FAIL" : "ok  "}  ${name} · ${fadeNote}`);
  if (problem) console.log(`        ${problem}`);
  if (verbose || problem) {
    for (const l of lines) console.log(`        | ${l}`);
    console.log(`        video ${JSON.stringify(video)}  audio ${JSON.stringify(audio)}`);
  }
}

const shot = (name, start, end, extra = {}) => ({
  filePath: `/f/${name}`, fileName: name,
  sourceInSec: 0, sourceOutSec: end - start,
  timelineStartSec: start, timelineEndSec: end,
  useSourceAudio: false, sourceDurationSec: 60, fps: 50, width: 1080, height: 1920,
  ...extra,
});

const moment = (name, start, end, extra = {}) => ({
  filePath: `/f/${name}`, fileName: name,
  sourceInSec: 1, sourceOutSec: 1 + (end - start),
  timelineStartSec: start, timelineEndSec: end,
  ...extra,
});

const base = { name: "sim", fps: 50, width: 1080, height: 1920, durationSec: 6 };

const twoLayer = {
  ...base,
  clips: [moment("A.MP4", 0, 3), moment("B.MP4", 3, 6)],
  videoLayer: [shot("C.MP4", 0, 2), shot("D.MP4", 2, 4), shot("E.MP4", 4, 6)],
};

const withSfx = {
  ...twoLayer,
  videoLayer: [
    shot("C.MP4", 0, 2),
    shot("D.MP4", 2, 4, { useSourceAudio: true }),
    shot("E.MP4", 4, 6),
  ],
};

const broll = {
  ...base,
  clips: [
    moment("A.MP4", 0, 3),
    moment("B.MP4", 3, 6, {
      videoOverride: { filePath: "/f/C.MP4", fileName: "C.MP4", sourceInSec: 0, sourceOutSec: 3 },
    }),
  ],
};

/**
 * Expected audio tracks. A source with N channels occupies N tracks, so the
 * spine takes 0..N-1 — and a kept sound effect, being the same kind of source,
 * takes another N above it. Both bands are legitimate output; everything above
 * them is parked media that must be gone.
 */
const spineOnly = (ch) => [...Array(ch).keys()];
const spinePlusSfx = (ch) => [...Array(ch * 2).keys()];

const verbose = process.argv.includes("--verbose");

(async () => {
  for (const strict of [false, true]) {
    for (const audioChannels of [1, 2, 4]) {
      await run({ label: "two layers", plan: twoLayer, audioChannels, expectAudioTracks: spineOnly(audioChannels), strict, verbose });
      await run({ label: "two layers + kept sfx", plan: withSfx, audioChannels, expectAudioTracks: spinePlusSfx(audioChannels), strict, verbose });
      await run({ label: "legacy B-roll path", plan: broll, audioChannels, expectAudioTracks: spineOnly(audioChannels), strict, verbose });
    }
  }

  // The scale and the refusals. Writing a ramp in the wrong units would
  // silence the cut, so "declines to act" is the required behaviour here, not
  // a missing feature.
  await run({
    label: "fades · normalised scale (unity reads 1)", plan: twoLayer, audioChannels: 2,
    expectAudioTracks: spineOnly(2), strict: true, verbose, levelUnity: 1,
  });
  await run({
    label: "fades · refuses an unrecognised scale", plan: twoLayer, audioChannels: 2,
    expectAudioTracks: spineOnly(2), strict: true, verbose,
    levelUnity: 7.5, expectFades: false,
  });
  await run({
    label: "fades · refuses when there is no volume component", plan: twoLayer, audioChannels: 2,
    expectAudioTracks: spineOnly(2), strict: true, verbose,
    volumeMatchName: null, expectFades: false,
  });

  console.log("");
  if (failures.length > 0) {
    console.log(`${failures.length} scenario(s) failed:`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log("All scenarios left one picture track and only the intended audio tracks.");
})().catch((e) => { console.error("SIM CRASHED:", e); process.exit(1); });
