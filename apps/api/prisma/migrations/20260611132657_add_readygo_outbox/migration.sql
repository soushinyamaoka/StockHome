-- CreateTable
CREATE TABLE "readygo_outbox" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "alerts_json" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delivered_at" TIMESTAMP(3),

    CONSTRAINT "readygo_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "readygo_outbox_status_idx" ON "readygo_outbox"("status");
