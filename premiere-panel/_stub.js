/* HARNESS ONLY — stubs the UXP runtime so the real panel markup can be
   rendered and inspected in an ordinary browser. Not shipped.

   Injected into a copy of the REAL index.html by scripts/build-panel-harness.mjs.
   It is never a copy of the markup: the previous harness kept its own
   duplicate of the whole body, which silently drifted and then reported that
   a newly added element did not exist. Its comment claimed it was built from
   index.html; it was not. */

    const MOCK_PROJECTS = [
      { id: "p1", name: "חליטת תה - סט מוקטן", outputProfile: "SOCIAL_POST", assetCount: 11, transcriptCount: 11, momentCount: 9 },
      { id: "p2", name: "מסעדת השף - ריל", outputProfile: "REEL_SHORT", assetCount: 38, transcriptCount: 38, momentCount: 5 },
      { id: "p3", name: "Ingest smoke test", outputProfile: "REEL_SHORT", assetCount: 3, transcriptCount: 0, momentCount: 0 }
    ];
    const MOCK_STATE = {
      name: "חליטת תה - סט מוקטן",
      outputProfile: "SOCIAL_POST",
      stages: {
        ingest:     { done: true,  detail: "11 file(s)",      approved: true,  job: null },
        transcribe: { done: true,  detail: "11/11 transcribed", approved: true, job: { status: "running", startedAt: "" } },
        select:     { done: true,  detail: "9 moment(s)",     approved: false, job: null }
      },
      premise: "סיפור על חליטת תה מהשדה עד הכוס",
      beatPlan: ["הוק", "גוף", "תוצאה"],
      selections: [
        { fileName: "0X7A1667.MP4", startSec: 1.2, endSec: 3.4, reason: "", videoFileName: null },
        { fileName: "0X7A1668.MP4", startSec: 0.5, endSec: 2.9, reason: "", videoFileName: "0X7A1682.MP4" },
        { fileName: "0X7A1682.MP4", startSec: 4.0, endSec: 7.5, reason: "", videoFileName: null }
      ],
      videoLayer: [
        { fileName: "0X7A1694.MP4", timelineStartSec: 0, timelineEndSec: 1.9, sourceStartSec: 17, useSourceAudio: false, reason: "טיזר: יציקת משקה חם", qualityScore: 0.78 },
        { fileName: "0X7A1667.MP4", timelineStartSec: 1.9, timelineEndSec: 3.7, sourceStartSec: 0.5, useSourceAudio: false, reason: "סקירת שדה ניסיוני רחבה", qualityScore: 0.69 },
        { fileName: "0X7A1668.MP4", timelineStartSec: 3.7, timelineEndSec: 5.5, sourceStartSec: 4.5, useSourceAudio: false, reason: "הליכה בשביל השדה", qualityScore: 0.71 },
        { fileName: "0X7A1693.MP4", timelineStartSec: 31.3, timelineEndSec: 32.6, sourceStartSec: 21.5, useSourceAudio: true, reason: "מים רותחים באש", qualityScore: 0.86 }
      ],
      canRefine: true,
      notChosen: [
        { fileName: "0X7A1690.MP4", startSec: 2, endSec: 5, text: "פה מדברים על הזעתר", visualSummary: "שדה ירוק" }
      ],
      profilePreviews: [
        { outputProfile: "REEL_SHORT", momentCount: 5, totalDurationSec: 18, premise: null },
        { outputProfile: "SOCIAL_POST", momentCount: 9, totalDurationSec: 47, premise: null }
      ],
      refinementDraft: {
        turns: [
          { instruction: "תוריד את הרגע האחרון", response: "הורדתי את הרגע השלישי.", ok: true },
          { instruction: "תעשה פתיח של 9 שניות", response: "לא ניתן — כלל ההוק הוא 3 שניות.", ok: false }
        ],
        selections: [{ fileName: "0X7A1667.MP4", startSec: 1.2, endSec: 3.4 }],
        premise: null,
        totalDurationSec: 32,
        diff: [
          { status: "kept", fileName: "0X7A1667.MP4", startSec: 1.2, endSec: 3.4 },
          { status: "removed", fileName: "0X7A1682.MP4", startSec: 4, endSec: 7.5 },
          { status: "moved", fileName: "0X7A1668.MP4", startSec: 0.5, endSec: 2.9 }
        ]
      }
    };
    window.require = (name) => {
      if (name === "premierepro") return {
        Project: { getActiveProject: async () => ({ name: "Untitled.prproj", getActiveSequence: async () => ({ name: "Sequence 01" }) }) }
      };
      if (name === "uxp") return { storage: { localFileSystem: { getFolder: async () => ({ nativePath: "/Users/ohadfait/Desktop/חליטת תה copy" }) } } };
      if (name === "./build-sequence") return {
        APP_ORIGIN: "http://localhost:3002",
        fetchProjects: async () => MOCK_PROJECTS,
        fetchPlan: async () => ({ name: "חליטת תה", clips: [], durationSec: 0, fps: 50, width: 1080, height: 1920, missingSources: [] }),
        buildSequence: async () => ({ sequenceName: "x", clips: 0 })
      };
      if (name === "./state") return {
        fetchState: async () => MOCK_STATE,
        applyProfile: async () => ({}), sendRefinement: async () => ({}),
        applyDraft: async () => ({}), discardDraft: async () => ({}),
        generateAllProfiles: async () => ({}), createProject: async () => ({ project: { id: "p9", name: "New" } }),
        startStage: async () => ({}), approveStage: async () => ({})
      };
      throw new Error("unstubbed require: " + name);
    };
    
