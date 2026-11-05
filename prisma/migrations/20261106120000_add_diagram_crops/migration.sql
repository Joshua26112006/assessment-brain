-- Diagrams cropped from a student's answer sheet. Additive: one new table.
CREATE TABLE "DiagramCrop" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "questionId" TEXT,
    "pageNumber" INTEGER NOT NULL,
    "boxLeft" DOUBLE PRECISION NOT NULL,
    "boxTop" DOUBLE PRECISION NOT NULL,
    "boxWidth" DOUBLE PRECISION NOT NULL,
    "boxHeight" DOUBLE PRECISION NOT NULL,
    "storageKey" TEXT NOT NULL,
    "widthPx" INTEGER NOT NULL,
    "heightPx" INTEGER NOT NULL,
    "confident" BOOLEAN NOT NULL,
    "foundByInk" BOOLEAN NOT NULL,
    "foundByModel" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiagramCrop_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DiagramCrop_storageKey_key" ON "DiagramCrop"("storageKey");
CREATE INDEX "DiagramCrop_submissionId_idx" ON "DiagramCrop"("submissionId");
CREATE INDEX "DiagramCrop_questionId_idx" ON "DiagramCrop"("questionId");

ALTER TABLE "DiagramCrop" ADD CONSTRAINT "DiagramCrop_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
