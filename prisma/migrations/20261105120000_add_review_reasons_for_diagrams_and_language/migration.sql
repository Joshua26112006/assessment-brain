-- Hardening Phase 5: two review reasons. A diagram answer (decision D3) and an answer not written in
-- English (decision D7) are parked for the teacher instead of being given an AI mark. Additive only.

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ReviewReason" ADD VALUE 'DIAGRAM_TEACHER_ONLY';
ALTER TYPE "ReviewReason" ADD VALUE 'UNSUPPORTED_LANGUAGE';

