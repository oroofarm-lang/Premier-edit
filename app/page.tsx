import Link from "next/link";
import { prisma } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { NewProjectForm } from "@/components/new-project-form";
import { PROFILE_LABELS } from "@/lib/selection/types";

export const dynamic = "force-dynamic";

export default async function Home() {
  const projects = await prisma.project.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { mediaAssets: true } } },
  });

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <header dir="ltr" className="mb-10 text-right">
        <h1 className="text-2xl font-semibold tracking-tight">Premier Edit</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Point at a footage folder and an audio folder, and the pipeline takes it
          from there.
        </p>
      </header>

      <Card className="mb-10">
        <CardHeader>
          <CardTitle className="text-base">New project</CardTitle>
        </CardHeader>
        <CardContent>
          <NewProjectForm />
        </CardContent>
      </Card>

      <section>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">Projects</h2>
        {projects.length === 0 ? (
          <p dir="ltr" className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            No projects yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {projects.map((project) => (
              <li key={project.id}>
                <Button
                  asChild
                  variant="outline"
                  className="h-auto w-full justify-between px-4 py-3"
                >
                  <Link href={`/projects/${project.id}`}>
                    <span className="flex flex-col items-start gap-1">
                      <span dir="auto" className="font-medium">{project.name}</span>
                      <span dir="ltr" className="text-xs text-muted-foreground">
                        {project._count.mediaAssets} assets
                      </span>
                    </span>
                    <Badge dir="ltr" variant="secondary">
                      {PROFILE_LABELS[project.outputProfile]}
                    </Badge>
                  </Link>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
