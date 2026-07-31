"use client";

import { useTransition } from "react";
import { selectContentAllProfiles } from "@/app/actions";
import { Button } from "@/components/ui/button";

export function GenerateAllProfilesButton({ projectId }: { projectId: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() => startTransition(() => selectContentAllProfiles(projectId))}
    >
      {pending ? "Generating..." : "Generate all 3 profiles"}
    </Button>
  );
}
