-- CreateTable
CREATE TABLE "VideoPlacement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "shotId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "timelineStartSec" REAL NOT NULL,
    "timelineEndSec" REAL NOT NULL,
    "useSourceAudio" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VideoPlacement_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "VideoPlacement_shotId_fkey" FOREIGN KEY ("shotId") REFERENCES "Shot" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "VideoPlacement_projectId_order_idx" ON "VideoPlacement"("projectId", "order");
