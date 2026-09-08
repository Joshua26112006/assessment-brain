-- CreateEnum
CREATE TYPE "QuestionValidationIssueType" AS ENUM ('MISSING_INFORMATION', 'AMBIGUOUS_QUESTION', 'CONTRADICTORY_INFORMATION', 'INVALID_DATA', 'MISSING_REFERENCE', 'INCOMPLETE_QUESTION');

-- AlterEnum
ALTER TYPE "RubricGenerationStatus" ADD VALUE 'REVIEW_REQUIRED';

-- AlterTable
ALTER TABLE "Rubric" ADD COLUMN     "validationExplanation" TEXT,
ADD COLUMN     "validationIssueSummary" TEXT,
ADD COLUMN     "validationIssueType" "QuestionValidationIssueType";
