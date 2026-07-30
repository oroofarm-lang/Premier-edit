"use client";

import { useTransition } from "react";
import { exportTimeline } from "@/app/actions";
import { Button } from "@/components/ui/button";

export function ExportButton({
  projectId,
  hasExports,
}: {
  projectId: string;
  hasExports: boolean;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      size="sm"
      variant={hasExports ? "outline" : "default"}
      disabled={pending}
      onClick={() => startTransition(() => exportTimeline(projectId))}
    >
      {pending
        ? "Exporting..."
        : hasExports
          ? "Export again"
          : "Export timeline XML"}
    </Button>
  );
}
