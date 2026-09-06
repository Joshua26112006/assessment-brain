-- CreateEnum
CREATE TYPE "SubmissionProcessingStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'INVALID', 'FAILED');

-- CreateTable
CREATE TABLE "SubmissionProcessing" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "status" "SubmissionProcessingStatus" NOT NULL DEFAULT 'PENDING',
    "validationResult" JSONB,
    "answerIndex" JSONB,
    "processingError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubmissionProcessing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubmissionProcessing_submissionId_key" ON "SubmissionProcessing"("submissionId");

-- CreateIndex
CREATE INDEX "SubmissionProcessing_status_idx" ON "SubmissionProcessing"("status");

-- AddForeignKey
ALTER TABLE "SubmissionProcessing" ADD CONSTRAINT "SubmissionProcessing_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
