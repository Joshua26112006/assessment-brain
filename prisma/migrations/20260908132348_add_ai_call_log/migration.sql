-- CreateTable
CREATE TABLE "AiCallLog" (
    "id" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "promptTokens" INTEGER NOT NULL,
    "completionTokens" INTEGER NOT NULL,
    "costUsd" DECIMAL(10,6) NOT NULL,
    "context" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiCallLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiCallLog_stage_idx" ON "AiCallLog"("stage");

-- CreateIndex
CREATE INDEX "AiCallLog_model_idx" ON "AiCallLog"("model");

-- CreateIndex
CREATE INDEX "AiCallLog_createdAt_idx" ON "AiCallLog"("createdAt");
