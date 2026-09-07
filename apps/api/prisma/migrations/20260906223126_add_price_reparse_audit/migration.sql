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
