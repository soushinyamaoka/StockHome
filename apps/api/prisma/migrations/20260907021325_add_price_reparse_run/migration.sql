-- CreateTable
CREATE TABLE "price_reparse_runs" (
    "id" TEXT NOT NULL,
    "run_token" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "imported_by_email" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "price_reparse_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "price_reparse_runs_run_token_key" ON "price_reparse_runs"("run_token");
