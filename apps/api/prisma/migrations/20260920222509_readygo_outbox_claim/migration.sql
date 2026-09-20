-- AlterTable
ALTER TABLE "readygo_outbox" ADD COLUMN     "claimed_at" TIMESTAMP(3);

-- Partial unique index: at most one 'pending' row per household, enforced at
-- the DB level so concurrent batch runs (manual x manual, cron x manual)
-- cannot both insert a fresh pending row (notice 20260920-STOCKHOME-014,
-- S014-B01). Prisma's @@unique cannot express a WHERE clause, so this is
-- hand-written rather than schema-generated.
CREATE UNIQUE INDEX "readygo_outbox_pending_household_unique"
  ON "readygo_outbox" ("household_id")
  WHERE "status" = 'pending';
