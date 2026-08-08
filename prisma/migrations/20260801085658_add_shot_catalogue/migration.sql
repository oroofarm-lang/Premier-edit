-- CreateTable
CREATE TABLE "Shot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mediaAssetId" TEXT NOT NULL,
    "startSec" REAL NOT NULL,
    "endSec" REAL NOT NULL,
    "source" TEXT NOT NULL,
    "stability" REAL NOT NULL,
    "movementCompleteness" REAL NOT NULL,
    "sharpness" REAL,
    "exposure" REAL,
    "qualityScore" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Shot_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Shot_mediaAssetId_qualityScore_idx" ON "Shot"("mediaAssetId", "qualityScore");

-- CreateIndex
CREATE UNIQUE INDEX "Shot_mediaAssetId_startSec_endSec_key" ON "Shot"("mediaAssetId", "startSec", "endSec");
