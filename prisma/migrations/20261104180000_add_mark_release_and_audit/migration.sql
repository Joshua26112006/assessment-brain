-- CreateEnum
CREATE TYPE "MarkEventKind" AS ENUM ('AI_DRAFT', 'AI_RUN', 'TEACHER_ACCEPT', 'TEACHER_CHANGE', 'TEACHER_COMMENT', 'TEACHER_FINDING', 'TEACHER_TRANSCRIPTION', 'SCHEME_REAPPLIED', 'RECHECK', 'SUBMISSION_CONFIRMED', 'SUBMISSION_RELEASED', 'SUBMISSION_REOPENED');

-- AlterTable
ALTER TABLE "Submission" ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "confirmedById" TEXT,
ADD COLUMN     "releasedAt" TIMESTAMP(3),
ADD COLUMN     "releasedById" TEXT;

-- CreateTable
CREATE TABLE "MarkEvent" (
    "id" TEXT NOT NULL,
    "kind" "MarkEventKind" NOT NULL,
    "submissionId" TEXT NOT NULL,
    "questionResponseId" TEXT,
    "marks" DECIMAL(6,2),
    "previousMarks" DECIMAL(6,2),
    "actorId" TEXT,
    "reason" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarkEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarkEvent_submissionId_createdAt_idx" ON "MarkEvent"("submissionId", "createdAt");

-- CreateIndex
CREATE INDEX "MarkEvent_questionResponseId_createdAt_idx" ON "MarkEvent"("questionResponseId", "createdAt");

-- CreateIndex
CREATE INDEX "MarkEvent_actorId_idx" ON "MarkEvent"("actorId");

-- CreateIndex
CREATE INDEX "Submission_confirmedById_idx" ON "Submission"("confirmedById");

-- CreateIndex
CREATE INDEX "Submission_releasedById_idx" ON "Submission"("releasedById");

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_releasedById_fkey" FOREIGN KEY ("releasedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarkEvent" ADD CONSTRAINT "MarkEvent_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarkEvent" ADD CONSTRAINT "MarkEvent_questionResponseId_fkey" FOREIGN KEY ("questionResponseId") REFERENCES "QuestionResponse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarkEvent" ADD CONSTRAINT "MarkEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- MarkEvent is an append-only audit trail: reject any UPDATE or DELETE, so a
-- mark's history cannot be rewritten by a bug, a script or a hand-run query.
CREATE FUNCTION "markevent_append_only"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'MarkEvent rows are append-only (attempted %)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "MarkEvent_append_only"
BEFORE UPDATE OR DELETE ON "MarkEvent"
FOR EACH ROW EXECUTE FUNCTION "markevent_append_only"();
