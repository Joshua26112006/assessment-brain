-- Figures of a digital question paper and a teacher's model diagrams. Additive: a new table and two new enums.
CREATE TYPE "QuestionFigureRole" AS ENUM ('QUESTION_FIGURE', 'MODEL_DIAGRAM');
CREATE TYPE "QuestionFigureSource" AS ENUM ('PDF_DETECTED', 'TEACHER_UPLOAD');

CREATE TABLE "QuestionFigure" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "questionId" TEXT,
    "role" "QuestionFigureRole" NOT NULL DEFAULT 'QUESTION_FIGURE',
    "source" "QuestionFigureSource" NOT NULL,
    "pageNumber" INTEGER,
    "boxLeft" DOUBLE PRECISION,
    "boxTop" DOUBLE PRECISION,
    "boxWidth" DOUBLE PRECISION,
    "boxHeight" DOUBLE PRECISION,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "widthPx" INTEGER NOT NULL,
    "heightPx" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuestionFigure_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "QuestionFigure_storageKey_key" ON "QuestionFigure"("storageKey");
CREATE INDEX "QuestionFigure_assessmentId_idx" ON "QuestionFigure"("assessmentId");
CREATE INDEX "QuestionFigure_questionId_idx" ON "QuestionFigure"("questionId");

ALTER TABLE "QuestionFigure" ADD CONSTRAINT "QuestionFigure_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuestionFigure" ADD CONSTRAINT "QuestionFigure_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;
