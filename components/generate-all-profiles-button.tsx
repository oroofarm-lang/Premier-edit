"use client";

import { useTransition } from "react";
import { selectContentAllProfiles } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

export function GenerateAllProfilesButton({ projectId }: { projectId: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      size="sm"
      dir="ltr"
      variant="outline"
      disabled={pending}
      className={pending ? "shadow-glow" : undefined}
      onClick={() => startTransition(() => selectContentAllProfiles(projectId))}
    >
      {pending && <Spinner />}
      {pending ? "Generating..." : "Generate all 3 profiles"}
    </Button>
  );
}
