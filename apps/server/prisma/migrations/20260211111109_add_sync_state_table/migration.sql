-- CreateTable
CREATE TABLE "sync_states" (
    "id" TEXT NOT NULL,
    "source" VARCHAR(100) NOT NULL,
    "entityName" VARCHAR(200) NOT NULL,
    "stateKey" VARCHAR(200) NOT NULL DEFAULT 'default',
    "stateValue" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sync_states_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sync_states_source_entityName_stateKey_key" ON "sync_states"("source", "entityName", "stateKey");
