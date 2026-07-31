"use client";

import { useState, useTransition } from "react";
import {
  applyRefinementAction,
  discardRefinementAction,
  refineSelectionAction,
} from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { diffSelections, type RefinementDraft } from "@/lib/selection/refine-plan";
import type { SelectedSegment } from "@/lib/selection/types";

const STATUS_LABEL: Record<string, string> = {
  kept: "נשאר",
  added: "נוסף",
  removed: "הוסר",
  moved: "הוזז",
};

const STATUS_CLASS: Record<string, string> = {
  kept: "text-muted-foreground",
  added: "text-success",
  removed: "text-destructive",
  moved: "text-accent",
};

export function RefinementPanel({
  projectId,
  currentSelections,
  fileNameByAssetId,
  draft,
}: {
  projectId: string;
  /** The project's live cut — the "before" side of the diff, and what the numbered chips refer to. */
  currentSelections: SelectedSegment[];
  fileNameByAssetId: Record<string, string>;
  draft: RefinementDraft | null;
}) {
  const [instruction, setInstruction] = useState("");
  const [pending, startTransition] = useTransition();

  function send() {
    const text = instruction.trim();
    if (!text) return;
    startTransition(async () => {
      await refineSelectionAction(projectId, text);
      setInstruction("");
    });
  }

  const diff = draft ? diffSelections(currentSelections, draft.result.selections) : [];
  const changed = diff.filter((d) => d.status !== "kept");
  const draftDuration = draft
    ? Math.round(
        draft.result.selections.reduce((sum, s) => sum + (s.endSec - s.startSec), 0) * 10,
      ) / 10
    : 0;

  return (
    <div className="mt-4 rounded-lg border px-3 py-3">
      <p className="text-sm font-medium">שיפור הקאט בשיחה</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        תכתוב מה לשנות — למשל &quot;תוריד את הרגע האחרון&quot; או &quot;תחליף את רגע 2
        למשהו קצר יותר&quot;. כל הוראה ממשיכה מהקודמת.
      </p>

      {currentSelections.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          <span className="text-xs text-muted-foreground">הפניה מהירה:</span>
          {currentSelections.map((_, i) => (
            <button
              key={i}
              type="button"
              disabled={pending}
              onClick={() =>
                setInstruction((prev) => (prev ? `${prev.trimEnd()} ` : "") + `רגע ${i + 1}: `)
              }
              className="rounded-md border px-2 py-0.5 text-xs transition-colors hover:bg-muted disabled:opacity-50"
            >
              {i + 1}
            </button>
          ))}
        </div>
      )}

      {draft && draft.turns.length > 0 && (
        <ul className="mt-3 space-y-2">
          {draft.turns.map((turn, i) => (
            <li key={i} className="rounded-md bg-muted/30 px-2 py-1.5 text-xs">
              <p dir="auto" className="font-medium">
                ← {turn.instruction}
              </p>
              <p
                dir="auto"
                className={`mt-0.5 ${turn.ok ? "text-muted-foreground" : "text-destructive"}`}
              >
                {turn.ok ? "✓ " : "✕ לא בוצע — "}
                {turn.response}
              </p>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 space-y-2">
        <Textarea
          dir="auto"
          rows={2}
          value={instruction}
          disabled={pending}
          placeholder="מה לשנות בקאט?"
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter for a newline, the usual chat convention.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <Button
          size="sm"
          disabled={pending || !instruction.trim()}
          className={pending ? "shadow-glow" : undefined}
          onClick={send}
        >
          {pending && <Spinner />}
          {pending ? "מעדכן..." : "שלח"}
        </Button>
      </div>

      {draft && (
        <div className="mt-4 rounded-lg border bg-muted/30 px-3 py-2">
          <p className="text-sm font-medium">
            גרסה מוצעת · {draft.result.selections.length} רגעים · {draftDuration}s
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {changed.length === 0
              ? "אין שינוי לעומת הקאט הנוכחי."
              : `${changed.length} שינויים לעומת הקאט הנוכחי.`}
          </p>

          <ul className="mt-2 space-y-1">
            {diff.map((entry, i) => (
              <li key={i} className="text-xs">
                <span className={STATUS_CLASS[entry.status]}>
                  {STATUS_LABEL[entry.status]}
                </span>{" "}
                <span className="font-mono text-muted-foreground" dir="ltr">
                  {fileNameByAssetId[entry.mediaAssetId] ?? entry.mediaAssetId} ·{" "}
                  {entry.startSec}–{entry.endSec}s
                </span>
              </li>
            ))}
          </ul>

          {draft.result.premise && (
            <p dir="auto" className="mt-2 text-xs">
              💡 {draft.result.premise}
            </p>
          )}

          <div className="mt-3 flex gap-2">
            <ApplyButton projectId={projectId} />
            <DiscardButton projectId={projectId} />
          </div>
        </div>
      )}
    </div>
  );
}

function ApplyButton({ projectId }: { projectId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      disabled={pending}
      className={pending ? "shadow-glow" : undefined}
      onClick={() => startTransition(() => applyRefinementAction(projectId))}
    >
      {pending && <Spinner />}
      {pending ? "מחיל..." : "החל על הקאט"}
    </Button>
  );
}

function DiscardButton({ projectId }: { projectId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() => startTransition(() => discardRefinementAction(projectId))}
    >
      {pending ? "..." : "בטל"}
    </Button>
  );
}
