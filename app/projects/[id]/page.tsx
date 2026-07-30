import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { IngestButton } from "@/components/ingest-button";
import { ApproveCheckpointButton } from "@/components/approve-checkpoint-button";
import { TranscribeButton } from "@/components/transcribe-button";
import { SelectContentButton } from "@/components/select-content-button";
import { ExportButton } from "@/components/export-button";

export const dynamic = "force-dynamic";

function formatDuration(seconds: number | null) {
  if (seconds === null) return "—";
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function formatResolution(width: number | null, height: number | null) {
  if (!width || !height) return null;
  return `${width}×${height}`;
}

export default async function ProjectPage({
  params,
}: {
  params: { id: string };
}) {
  const project = await prisma.project.findUnique({
    where: { id: params.id },
    include: {
      mediaAssets: {
        orderBy: { filePath: "asc" },
        include: { transcript: true },
      },
      checkpoints: { orderBy: { createdAt: "asc" } },
      selections: {
        orderBy: { order: "asc" },
        include: { mediaAsset: true },
      },
      editVersions: {
        orderBy: { versionNum: "desc" },
        include: { timeline: true },
      },
    },
  });

  if (!project) notFound();

  const videos = project.mediaAssets.filter((a) => a.kind === "VIDEO");
  const audio = project.mediaAssets.filter((a) => a.kind === "AUDIO");
  const ingestCheckpoint = project.checkpoints.find((c) => c.stage === "INGEST");
  const transcriptionCheckpoint = project.checkpoints.find(
    (c) => c.stage === "TRANSCRIPTION",
  );
  const selectionCheckpoint = project.checkpoints.find(
    (c) => c.stage === "CONTENT_SELECTION",
  );
  const selectedDuration =
    Math.round(
      project.selections.reduce((sum, s) => sum + (s.endSec - s.startSec), 0) *
        10,
    ) / 10;

  // Silent B-roll has no audio stream, so there is nothing to transcribe.
  const transcribable = project.mediaAssets.filter(
    (a) => a.kind === "AUDIO" || a.sampleRate !== null,
  );
  const transcribed = transcribable.filter((a) => a.transcript !== null);
  const pendingTranscription = transcribable.length - transcribed.length;

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <Link
        href="/"
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        ← All projects
      </Link>

      <header className="mb-8 mt-4">
        <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
        <dl className="mt-3 space-y-1 text-sm text-muted-foreground">
          <div>
            <dt className="inline font-medium">Footage: </dt>
            <dd className="inline font-mono text-xs">{project.footageFolder}</dd>
          </div>
          {project.audioFolder && (
            <div>
              <dt className="inline font-medium">Audio: </dt>
              <dd className="inline font-mono text-xs">{project.audioFolder}</dd>
            </div>
          )}
          {project.brief && (
            <div>
              <dt className="inline font-medium">Brief: </dt>
              <dd className="inline">{project.brief}</dd>
            </div>
          )}
        </dl>
      </header>

      <Card className="mb-8">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Ingest</CardTitle>
          <IngestButton
            projectId={project.id}
            hasAssets={project.mediaAssets.length > 0}
          />
        </CardHeader>
        <CardContent>
          {project.mediaAssets.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing ingested yet. Run ingest to scan the folders above.
            </p>
          ) : (
            <div className="space-y-1 text-sm">
              <p>
                <span className="font-medium">{videos.length}</span> video ·{" "}
                <span className="font-medium">{audio.length}</span> audio
              </p>
              {ingestCheckpoint && (
                <div className="flex items-center gap-3 pt-2">
                  {ingestCheckpoint.approved ? (
                    <Badge variant="secondary">Ingest approved</Badge>
                  ) : (
                    <ApproveCheckpointButton
                      checkpointId={ingestCheckpoint.id}
                      projectId={project.id}
                    />
                  )}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {ingestCheckpoint?.approved && (
        <Card className="mb-8">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Transcription</CardTitle>
            <TranscribeButton
              projectId={project.id}
              pendingCount={pendingTranscription}
            />
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {transcribed.length} of {transcribable.length} clips transcribed
              (Hebrew, running locally — nothing is uploaded).
            </p>
            {pendingTranscription > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                The first run downloads the model (~3GB) and takes a few minutes.
              </p>
            )}
            {transcriptionCheckpoint && transcribed.length > 0 && (
              <div className="pt-3">
                {transcriptionCheckpoint.approved ? (
                  <Badge variant="secondary">Transcription approved</Badge>
                ) : (
                  <ApproveCheckpointButton
                    checkpointId={transcriptionCheckpoint.id}
                    projectId={project.id}
                    label="Approve transcription"
                  />
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {transcriptionCheckpoint?.approved && (
        <Card className="mb-8">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Content selection</CardTitle>
            <SelectContentButton
              projectId={project.id}
              hasSelections={project.selections.length > 0}
            />
          </CardHeader>
          <CardContent>
            {project.selections.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Pick the moments worth cutting, based on the transcript and the
                brief.
              </p>
            ) : (
              <>
                <p className="text-sm">
                  <span className="font-medium">
                    {project.selections.length}
                  </span>{" "}
                  moments · {selectedDuration}s total
                </p>
                <ol className="mt-3 space-y-2">
                  {project.selections.map((selection) => (
                    <li
                      key={selection.id}
                      className="rounded-lg border px-3 py-2 text-sm"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-mono text-xs text-muted-foreground">
                          {selection.mediaAsset.filePath.split("/").pop()} ·{" "}
                          {selection.startSec}–{selection.endSec}s
                        </span>
                        <Badge variant="outline">
                          {selection.score?.toFixed(2) ?? "—"}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {selection.reason}
                      </p>
                    </li>
                  ))}
                </ol>
                {selectionCheckpoint && (
                  <div className="pt-3">
                    {selectionCheckpoint.approved ? (
                      <Badge variant="secondary">Selection approved</Badge>
                    ) : (
                      <ApproveCheckpointButton
                        checkpointId={selectionCheckpoint.id}
                        projectId={project.id}
                        label="Approve selection"
                      />
                    )}
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {selectionCheckpoint?.approved && (
        <Card className="mb-8">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Rough cut → Premiere</CardTitle>
            <ExportButton
              projectId={project.id}
              hasExports={project.editVersions.length > 0}
            />
          </CardHeader>
          <CardContent>
            {project.editVersions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Builds a butt-joined rough cut from the approved moments and
                writes an FCP7 XML you import into Premiere via File → Import.
              </p>
            ) : (
              <ul className="space-y-2">
                {project.editVersions.map((version) => (
                  <li
                    key={version.id}
                    className="rounded-lg border px-3 py-2 text-sm"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium">v{version.versionNum}</span>
                      <span className="text-xs text-muted-foreground">
                        {version.note}
                      </span>
                    </div>
                    {version.timeline && (
                      <p
                        className="mt-1 break-all font-mono text-xs text-muted-foreground"
                        dir="ltr"
                      >
                        {version.timeline.filePath}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {transcribed.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">
            Transcripts
          </h2>
          <div className="space-y-3">
            {transcribed.map((asset) => (
              <Card key={asset.id}>
                <CardHeader className="pb-2">
                  <CardTitle className="font-mono text-xs font-normal text-muted-foreground">
                    {asset.filePath.split("/").pop()}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p dir="auto" className="text-sm leading-relaxed">
                    {asset.transcript?.text}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      {project.mediaAssets.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">
            Media assets
          </h2>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">File</th>
                  <th className="px-3 py-2 font-medium">Kind</th>
                  <th className="px-3 py-2 font-medium">Duration</th>
                  <th className="px-3 py-2 font-medium">Format</th>
                </tr>
              </thead>
              <tbody>
                {project.mediaAssets.map((asset) => {
                  const resolution = formatResolution(asset.width, asset.height);
                  return (
                    <tr key={asset.id} className="border-b last:border-0">
                      <td
                        className="max-w-md truncate px-3 py-2 font-mono text-xs"
                        title={asset.filePath}
                      >
                        {asset.filePath.split("/").pop()}
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant="outline">{asset.kind}</Badge>
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        {formatDuration(asset.durationSec)}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {[
                          asset.codec,
                          resolution,
                          asset.fps ? `${asset.fps}fps` : null,
                          asset.sampleRate ? `${asset.sampleRate}Hz` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}
