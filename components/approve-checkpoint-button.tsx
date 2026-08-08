"use client";

import { useTransition } from "react";
import { approveCheckpoint } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

export function ApproveCheckpointButton({
  checkpointId,
  projectId,
  label = "Approve ingest",
}: {
  checkpointId: string;
  projectId: string;
  label?: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      size="sm"
      disabled={pending}
      className={pending ? "shadow-glow" : undefined}
      onClick={() =>
        startTransition(() => approveCheckpoint(checkpointId, projectId))
      }
    >
      {pending && <Spinner />}
      {pending ? "Approving..." : label}
    </Button>
  );
}
