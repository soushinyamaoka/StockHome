-- AlterTable
ALTER TABLE "price_reparse_runs" ADD COLUMN "cutoff_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "price_reparse_audit" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'write';

-- CreateTable
CREATE TABLE "price_reparse_item_snapshots" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "reference_price" DOUBLE PRECISION,

    CONSTRAINT "price_reparse_item_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "price_reparse_item_snapshots_run_id_item_id_key" ON "price_reparse_item_snapshots"("run_id", "item_id");

-- CreateIndex
CREATE UNIQUE INDEX "price_reparse_audit_run_id_candidate_id_mode_key" ON "price_reparse_audit"("run_id", "candidate_id", "mode");
