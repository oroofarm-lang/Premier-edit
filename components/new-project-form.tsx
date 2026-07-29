"use client";

import { useFormState, useFormStatus } from "react-dom";
import { createProject, type ActionState } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Creating..." : "Create project"}
    </Button>
  );
}

export function NewProjectForm() {
  const [state, formAction] = useFormState<ActionState, FormData>(
    createProject,
    null,
  );

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="name">Project name</Label>
        <Input id="name" name="name" placeholder="Cafe Levi reel" required />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="outputProfile">Output profile</Label>
        <select
          id="outputProfile"
          name="outputProfile"
          defaultValue="REEL_SHORT"
          className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <option value="REEL_SHORT">Reel / Short</option>
          <option value="SOCIAL_POST">Social post</option>
          <option value="YOUTUBE_LONG">YouTube long-form</option>
        </select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="footageFolder">Footage folder</Label>
        <Input
          id="footageFolder"
          name="footageFolder"
          placeholder="/Users/you/Movies/shoot-raw"
          required
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="audioFolder">Audio folder (optional)</Label>
        <Input
          id="audioFolder"
          name="audioFolder"
          placeholder="/Users/you/Movies/shoot-audio"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="brief">Brief (optional)</Label>
        <Textarea
          id="brief"
          name="brief"
          rows={3}
          placeholder="30 second reel, upbeat, focus on the pasta dish and the chef talking about the sauce"
        />
      </div>

      {state?.error && (
        <p className="text-sm text-destructive">{state.error}</p>
      )}

      <SubmitButton />
    </form>
  );
}
