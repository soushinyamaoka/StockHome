-- VPS管理レビュー第5回R5-02対応: 明示的にBEGIN/COMMITで囲む（理由は
-- 20260906223126_add_price_reparse_audit/migration.sql冒頭コメント参照）
BEGIN;

-- CreateTable
CREATE TABLE "price_reparse_targets" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,

    CONSTRAINT "price_reparse_targets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "price_reparse_targets_run_id_idx" ON "price_reparse_targets"("run_id");

-- CreateIndex
CREATE UNIQUE INDEX "price_reparse_targets_run_id_candidate_id_key" ON "price_reparse_targets"("run_id", "candidate_id");

COMMIT;
