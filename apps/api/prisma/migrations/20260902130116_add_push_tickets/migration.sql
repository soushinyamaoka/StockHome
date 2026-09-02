-- VPS管理レビューB07対応: 理由は 20260902073443_add_push_devices/migration.sql の
-- 冒頭コメントを参照。中途半端な状態を残さないためBEGIN/COMMITで明示的に囲む
BEGIN;

-- CreateTable
CREATE TABLE "push_tickets" (
    "id" TEXT NOT NULL,
    "push_device_id" TEXT NOT NULL,
    "expo_ticket_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error_code" TEXT,
    "checked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "push_tickets_expo_ticket_id_key" ON "push_tickets"("expo_ticket_id");

-- CreateIndex
CREATE INDEX "push_tickets_status_created_at_idx" ON "push_tickets"("status", "created_at");

-- AddForeignKey
ALTER TABLE "push_tickets" ADD CONSTRAINT "push_tickets_push_device_id_fkey" FOREIGN KEY ("push_device_id") REFERENCES "push_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
