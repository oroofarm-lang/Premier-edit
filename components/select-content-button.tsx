"use client";

import { useTransition } from "react";
import { selectContent } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

export function SelectContentButton({
  projectId,
  hasSelections,
}: {
  projectId: string;
  hasSelections: boolean;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      size="sm"
      variant={hasSelections ? "outline" : "default"}
      disabled={pending}
      className={pending ? "shadow-glow" : undefined}
      onClick={() => startTransition(() => selectContent(projectId))}
    >
      {pending && <Spinner />}
      {pending
        ? "Selecting..."
        : hasSelections
          ? "Re-run selection"
          : "Select moments"}
    </Button>
  );
}
