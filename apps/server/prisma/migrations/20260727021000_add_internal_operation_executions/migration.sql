-- CreateTable
CREATE TABLE "public"."internal_operation_executions" (
    "id" TEXT NOT NULL,
    "operation" VARCHAR(80) NOT NULL,
    "idempotencyKey" VARCHAR(120) NOT NULL,
    "requestHash" VARCHAR(64) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "resultJson" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "internal_operation_executions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "internal_operation_executions_operation_idempotencyKey_key"
ON "public"."internal_operation_executions"("operation", "idempotencyKey");

-- CreateIndex
CREATE INDEX "internal_operation_executions_operation_createdAt_idx"
ON "public"."internal_operation_executions"("operation", "createdAt");
