-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Shot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mediaAssetId" TEXT NOT NULL,
    "startSec" REAL NOT NULL,
    "endSec" REAL NOT NULL,
    "source" TEXT NOT NULL,
    "stability" REAL NOT NULL,
    "movementCompleteness" REAL NOT NULL,
    "activity" REAL NOT NULL DEFAULT 0,
    "sharpness" REAL,
    "exposure" REAL,
    "qualityScore" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Shot_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Shot" ("createdAt", "endSec", "exposure", "id", "mediaAssetId", "movementCompleteness", "qualityScore", "sharpness", "source", "stability", "startSec") SELECT "createdAt", "endSec", "exposure", "id", "mediaAssetId", "movementCompleteness", "qualityScore", "sharpness", "source", "stability", "startSec" FROM "Shot";
DROP TABLE "Shot";
ALTER TABLE "new_Shot" RENAME TO "Shot";
CREATE INDEX "Shot_mediaAssetId_qualityScore_idx" ON "Shot"("mediaAssetId", "qualityScore");
CREATE UNIQUE INDEX "Shot_mediaAssetId_startSec_endSec_key" ON "Shot"("mediaAssetId", "startSec", "endSec");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
