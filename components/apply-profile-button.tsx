"use client";

import { useTransition } from "react";
import { applyProfileSelection } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { OutputProfile } from "@/lib/generated/prisma/enums";

export function ApplyProfileButton({
  projectId,
  outputProfile,
  isActive,
}: {
  projectId: string;
  outputProfile: OutputProfile;
  isActive: boolean;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      size="sm"
      variant={isActive ? "secondary" : "outline"}
      disabled={pending || isActive}
      className={pending ? "shadow-glow" : undefined}
      onClick={() =>
        startTransition(() => applyProfileSelection(projectId, outputProfile))
      }
    >
      {pending && <Spinner />}
      {pending ? "..." : isActive ? "Active" : "Use this cut"}
    </Button>
  );
}
