"use client";

import { useTransition } from "react";
import { applyProfileSelection } from "@/app/actions";
import { Button } from "@/components/ui/button";
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
      onClick={() =>
        startTransition(() => applyProfileSelection(projectId, outputProfile))
      }
    >
      {pending ? "..." : isActive ? "Active" : "Use this cut"}
    </Button>
  );
}
