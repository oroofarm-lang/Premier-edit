/*
  Warnings:

  - Added the required column `endSec` to the `VisualAnalysis` table without a default value. This is not possible if the table is not empty.
  - Added the required column `startSec` to the `VisualAnalysis` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_VisualAnalysis" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mediaAssetId" TEXT NOT NULL,
    "startSec" REAL NOT NULL,
    "endSec" REAL NOT NULL,
    "engine" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "shotType" TEXT,
    "tagsJson" TEXT NOT NULL,
    "qualityNotes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VisualAnalysis_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_VisualAnalysis" ("createdAt", "engine", "id", "mediaAssetId", "qualityNotes", "shotType", "summary", "tagsJson") SELECT "createdAt", "engine", "id", "mediaAssetId", "qualityNotes", "shotType", "summary", "tagsJson" FROM "VisualAnalysis";
DROP TABLE "VisualAnalysis";
ALTER TABLE "new_VisualAnalysis" RENAME TO "VisualAnalysis";
CREATE UNIQUE INDEX "VisualAnalysis_mediaAssetId_startSec_endSec_key" ON "VisualAnalysis"("mediaAssetId", "startSec", "endSec");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
