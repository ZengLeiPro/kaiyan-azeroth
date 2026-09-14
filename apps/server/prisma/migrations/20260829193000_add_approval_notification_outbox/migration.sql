CREATE TABLE "approval_notification_outbox" (
    "id" TEXT NOT NULL,
    "dedupKey" VARCHAR(160) NOT NULL,
    "eventType" VARCHAR(50) NOT NULL,
    "recipientEmployeeId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "approval_notification_outbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "approval_notification_outbox_dedupKey_key"
ON "approval_notification_outbox"("dedupKey");

CREATE INDEX "approval_notification_outbox_status_nextAttemptAt_idx"
ON "approval_notification_outbox"("status", "nextAttemptAt");

CREATE INDEX "approval_notification_outbox_recipientEmployeeId_idx"
ON "approval_notification_outbox"("recipientEmployeeId");
