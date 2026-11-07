-- Records that a teacher drew or corrected a diagram crop. Additive: one column with a default.
ALTER TABLE "DiagramCrop" ADD COLUMN "adjustedByTeacher" BOOLEAN NOT NULL DEFAULT false;
