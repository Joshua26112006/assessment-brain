-- CreateEnum
CREATE TYPE "RubricGenerationStatus" AS ENUM ('PENDING', 'GENERATING', 'READY', 'FAILED');

-- AlterTable
ALTER TABLE "Rubric" ADD COLUMN     "generationError" TEXT,
ADD COLUMN     "generationStatus" "RubricGenerationStatus" NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "RubricVersion" ADD COLUMN     "expectedAnswer" TEXT,
ADD COLUMN     "partialCreditGuidance" TEXT;

-- CreateIndex
CREATE INDEX "Rubric_generationStatus_idx" ON "Rubric"("generationStatus");
