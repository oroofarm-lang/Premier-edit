-- CreateTable
CREATE TABLE "VisualAnalysis" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mediaAssetId" TEXT NOT NULL,
    "engine" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "shotType" TEXT,
    "tagsJson" TEXT NOT NULL,
    "qualityNotes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VisualAnalysis_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "VisualAnalysis_mediaAssetId_key" ON "VisualAnalysis"("mediaAssetId");
