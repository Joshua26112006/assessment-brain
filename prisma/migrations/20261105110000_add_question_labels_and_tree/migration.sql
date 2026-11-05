-- Hardening Phase 3: question labels, answer types and the paper's structure (parts, "(a) OR (b)" choices,
-- "attempt any N" groups). Additive only: existing questions keep a null label and answer type and read as
-- before; existing assessments have no tree and are totalled as a flat list.

-- CreateEnum
CREATE TYPE "QuestionAnswerType" AS ENUM ('NUMERIC', 'SHORT_TEXT', 'DESCRIPTIVE', 'ESSAY', 'EXACT_KEY', 'DIAGRAM');

-- AlterTable
ALTER TABLE "Assessment" ADD COLUMN     "questionTree" JSONB;

-- AlterTable
ALTER TABLE "Question" ADD COLUMN     "answerType" "QuestionAnswerType",
ADD COLUMN     "label" TEXT;

