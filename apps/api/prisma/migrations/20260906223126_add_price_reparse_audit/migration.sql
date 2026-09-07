-- VPS管理レビュー第4回R4-04対応: 途中の文が失敗した場合に本tableと関連indexが
-- 中途半端な状態で残らないよう、明示的にBEGIN/COMMITで囲む（既存の
-- 20260902073443_add_push_devices/migration.sqlと同じ方針）
BEGIN;

-- CreateTable
CREATE TABLE "price_reparse_audit" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "purchase_id" TEXT,
    "before_detected_price" DOUBLE PRECISION,
    "before_price_source" TEXT,
    "before_purchase_price" DOUBLE PRECISION,
    "applied_detected_price" DOUBLE PRECISION,
    "applied_price_source" TEXT,
    "applied_purchase_price" DOUBLE PRECISION,
    "outcome" TEXT NOT NULL,
    "skip_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_reparse_audit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "price_reparse_audit_run_id_idx" ON "price_reparse_audit"("run_id");

-- CreateIndex
CREATE INDEX "price_reparse_audit_candidate_id_idx" ON "price_reparse_audit"("candidate_id");

COMMIT;
