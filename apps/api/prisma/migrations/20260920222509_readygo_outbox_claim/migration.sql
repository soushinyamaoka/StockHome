-- Resolve pre-existing duplicate 'pending' rows per household before adding
-- the uniqueness constraint below (notice 20260920-STOCKHOME-014, S014-B04).
-- The production baseline allowed multiple pending rows per household (that
-- duplication is exactly what this notice fixes), so the migration itself
-- must not assume the table is already deduplicated. Keep the most recently
-- created pending row per household (id is the tie-breaker for rows sharing
-- the same created_at); delete the rest.
DELETE FROM "readygo_outbox" a
USING "readygo_outbox" b
WHERE a."status" = 'pending'
  AND b."status" = 'pending'
  AND a."household_id" = b."household_id"
  AND (a."created_at", a."id") < (b."created_at", b."id");

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
