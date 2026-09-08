-- AlterTable
ALTER TABLE "AnswerSheetPage" ADD COLUMN     "annotatedStorageKey" TEXT;

-- AlterTable
ALTER TABLE "RubricVersion" ADD COLUMN     "structuredExpectation" JSONB;

-- CreateIndex
CREATE UNIQUE INDEX "AnswerSheetPage_annotatedStorageKey_key" ON "AnswerSheetPage"("annotatedStorageKey");

