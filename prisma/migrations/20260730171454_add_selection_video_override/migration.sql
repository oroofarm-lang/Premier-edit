-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Selection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "mediaAssetId" TEXT NOT NULL,
    "startSec" REAL NOT NULL,
    "endSec" REAL NOT NULL,
    "order" INTEGER NOT NULL,
    "score" REAL,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "videoAssetId" TEXT,
    "videoStartSec" REAL,
    "videoEndSec" REAL,
    CONSTRAINT "Selection_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Selection_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Selection_videoAssetId_fkey" FOREIGN KEY ("videoAssetId") REFERENCES "MediaAsset" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Selection" ("createdAt", "endSec", "id", "mediaAssetId", "order", "projectId", "reason", "score", "startSec") SELECT "createdAt", "endSec", "id", "mediaAssetId", "order", "projectId", "reason", "score", "startSec" FROM "Selection";
DROP TABLE "Selection";
ALTER TABLE "new_Selection" RENAME TO "Selection";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
