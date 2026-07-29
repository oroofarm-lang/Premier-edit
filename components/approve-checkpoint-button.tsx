"use client";

import { useTransition } from "react";
import { approveCheckpoint } from "@/app/actions";
import { Button } from "@/components/ui/button";

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
      onClick={() =>
        startTransition(() => approveCheckpoint(checkpointId, projectId))
      }
    >
      {pending ? "Approving..." : label}
    </Button>
  );
}
