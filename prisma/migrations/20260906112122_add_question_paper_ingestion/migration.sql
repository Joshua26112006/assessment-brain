-- CreateEnum
CREATE TYPE "QuestionPaperExtractionStatus" AS ENUM ('PENDING', 'PROCESSING', 'EXTRACTED', 'FAILED', 'APPROVED');

-- AlterTable
ALTER TABLE "Assessment" ADD COLUMN     "instructions" TEXT;

-- CreateTable
CREATE TABLE "QuestionPaper" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "extractionStatus" "QuestionPaperExtractionStatus" NOT NULL DEFAULT 'PENDING',
    "extractedContent" JSONB,
    "extractionError" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuestionPaper_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionPaperPage" (
    "id" TEXT NOT NULL,
    "questionPaperId" TEXT NOT NULL,
    "pageNumber" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuestionPaperPage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QuestionPaper_assessmentId_idx" ON "QuestionPaper"("assessmentId");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionPaperPage_storageKey_key" ON "QuestionPaperPage"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionPaperPage_questionPaperId_pageNumber_key" ON "QuestionPaperPage"("questionPaperId", "pageNumber");

-- AddForeignKey
ALTER TABLE "QuestionPaper" ADD CONSTRAINT "QuestionPaper_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionPaperPage" ADD CONSTRAINT "QuestionPaperPage_questionPaperId_fkey" FOREIGN KEY ("questionPaperId") REFERENCES "QuestionPaper"("id") ON DELETE CASCADE ON UPDATE CASCADE;
