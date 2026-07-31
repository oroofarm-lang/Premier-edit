"use client";

import { useTransition } from "react";
import { exportTimeline } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

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
      className={pending ? "shadow-glow" : undefined}
      onClick={() => startTransition(() => exportTimeline(projectId))}
    >
      {pending && <Spinner />}
      {pending
        ? "Exporting..."
        : hasExports
          ? "Export again"
          : "Export timeline XML"}
    </Button>
  );
}
