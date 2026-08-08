"use client";

import { useTransition } from "react";
import { ingestProject } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

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
      className={pending ? "shadow-glow" : undefined}
      onClick={() => startTransition(() => ingestProject(projectId))}
    >
      {pending && <Spinner />}
      {pending ? "Scanning..." : hasAssets ? "Re-scan folders" : "Run ingest"}
    </Button>
  );
}
