-- CreateTable
CREATE TABLE "AnswerSheetPage" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "pageNumber" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnswerSheetPage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AnswerSheetPage_storageKey_key" ON "AnswerSheetPage"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "AnswerSheetPage_submissionId_pageNumber_key" ON "AnswerSheetPage"("submissionId", "pageNumber");

-- AddForeignKey
ALTER TABLE "AnswerSheetPage" ADD CONSTRAINT "AnswerSheetPage_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
