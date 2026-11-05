-- Hardening Phase 2: the marking scheme as criteria, with explicit follow-through and no-working rules,
-- teacher approval on a rubric version, and two new review reasons. Additive only: no existing row or
-- column is changed. Existing rubric versions get no approvedAt on purpose: a teacher must approve them
-- (nothing is marked against an unapproved scheme). See 07-hardening-log.md.

-- CreateEnum
CREATE TYPE "FollowThroughRule" AS ENUM ('ALLOWED', 'NOT_ALLOWED', 'METHOD_ONLY');

-- CreateEnum
CREATE TYPE "NoWorkingRule" AS ENUM ('FINAL_ANSWER_ONLY', 'FULL_MARKS');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ReviewReason" ADD VALUE 'SCHEME_NOT_APPROVED';
ALTER TYPE "ReviewReason" ADD VALUE 'SCHEME_CHANGED';

-- AlterTable
ALTER TABLE "RubricVersion" ADD COLUMN     "acceptedAlternatives" JSONB,
ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "criteria" JSONB,
ADD COLUMN     "followThrough" "FollowThroughRule",
ADD COLUMN     "noWorkingRule" "NoWorkingRule";

-- AddForeignKey
ALTER TABLE "RubricVersion" ADD CONSTRAINT "RubricVersion_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

