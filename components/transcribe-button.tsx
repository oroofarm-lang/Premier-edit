"use client";

import { useTransition } from "react";
import { transcribeProject } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

export function TranscribeButton({
  projectId,
  pendingCount,
}: {
  projectId: string;
  pendingCount: number;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      size="sm"
      variant={pendingCount > 0 ? "default" : "outline"}
      disabled={pending || pendingCount === 0}
      className={pending ? "shadow-glow" : undefined}
      onClick={() => startTransition(() => transcribeProject(projectId))}
    >
      {pending && <Spinner />}
      {pending
        ? "Transcribing..."
        : pendingCount === 0
          ? "All transcribed"
          : `Transcribe ${pendingCount} clip${pendingCount === 1 ? "" : "s"}`}
    </Button>
  );
}
