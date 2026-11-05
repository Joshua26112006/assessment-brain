-- Per-question number-format settings (owner decision, Nov 5): whether a percentage answer or a decimal comma is read.
-- Additive: two columns with a default, so every existing row keeps today's behaviour (neither is read).
ALTER TABLE "RubricVersion" ADD COLUMN "acceptPercent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "decimalComma" BOOLEAN NOT NULL DEFAULT false;
