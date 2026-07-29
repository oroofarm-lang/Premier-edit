"use client";

import { useTransition } from "react";
import { ingestProject } from "@/app/actions";
import { Button } from "@/components/ui/button";

export function IngestButton({
  projectId,
  hasAssets,
}: {
  projectId: string;
  hasAssets: boolean;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      size="sm"
      variant={hasAssets ? "outline" : "default"}
      disabled={pending}
      onClick={() => startTransition(() => ingestProject(projectId))}
    >
      {pending ? "Scanning..." : hasAssets ? "Re-scan folders" : "Run ingest"}
    </Button>
  );
}
