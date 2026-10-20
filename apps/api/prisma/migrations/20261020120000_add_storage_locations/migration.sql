-- CreateTable
CREATE TABLE "storage_locations" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parent_id" TEXT,
    "memo" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "storage_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storage_things" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "memo" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "storage_things_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storage_placements" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "item_id" TEXT,
    "thing_id" TEXT,
    "memo" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "storage_placements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_tags" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usage_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_tag_links" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "tag_id" TEXT NOT NULL,
    "item_id" TEXT,
    "thing_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_tag_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "storage_locations_household_id_idx" ON "storage_locations"("household_id");

-- CreateIndex
CREATE INDEX "storage_locations_parent_id_idx" ON "storage_locations"("parent_id");

-- CreateIndex
CREATE INDEX "storage_things_household_id_idx" ON "storage_things"("household_id");

-- CreateIndex
CREATE INDEX "storage_placements_household_id_idx" ON "storage_placements"("household_id");

-- CreateIndex
CREATE INDEX "storage_placements_item_id_idx" ON "storage_placements"("item_id");

-- CreateIndex
CREATE INDEX "storage_placements_thing_id_idx" ON "storage_placements"("thing_id");

-- CreateIndex
CREATE UNIQUE INDEX "storage_placements_location_id_item_id_key" ON "storage_placements"("location_id", "item_id");

-- CreateIndex
CREATE UNIQUE INDEX "storage_placements_location_id_thing_id_key" ON "storage_placements"("location_id", "thing_id");

-- CreateIndex
CREATE UNIQUE INDEX "usage_tags_household_id_name_key" ON "usage_tags"("household_id", "name");

-- CreateIndex
CREATE INDEX "usage_tag_links_household_id_idx" ON "usage_tag_links"("household_id");

-- CreateIndex
CREATE INDEX "usage_tag_links_item_id_idx" ON "usage_tag_links"("item_id");

-- CreateIndex
CREATE INDEX "usage_tag_links_thing_id_idx" ON "usage_tag_links"("thing_id");

-- CreateIndex
CREATE UNIQUE INDEX "usage_tag_links_tag_id_item_id_key" ON "usage_tag_links"("tag_id", "item_id");

-- CreateIndex
CREATE UNIQUE INDEX "usage_tag_links_tag_id_thing_id_key" ON "usage_tag_links"("tag_id", "thing_id");

-- AddForeignKey
ALTER TABLE "storage_locations" ADD CONSTRAINT "storage_locations_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storage_locations" ADD CONSTRAINT "storage_locations_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "storage_locations"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storage_things" ADD CONSTRAINT "storage_things_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storage_placements" ADD CONSTRAINT "storage_placements_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storage_placements" ADD CONSTRAINT "storage_placements_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "storage_locations"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storage_placements" ADD CONSTRAINT "storage_placements_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storage_placements" ADD CONSTRAINT "storage_placements_thing_id_fkey" FOREIGN KEY ("thing_id") REFERENCES "storage_things"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_tags" ADD CONSTRAINT "usage_tags_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_tag_links" ADD CONSTRAINT "usage_tag_links_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_tag_links" ADD CONSTRAINT "usage_tag_links_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "usage_tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_tag_links" ADD CONSTRAINT "usage_tag_links_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_tag_links" ADD CONSTRAINT "usage_tag_links_thing_id_fkey" FOREIGN KEY ("thing_id") REFERENCES "storage_things"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- 同じ親の下で場所名を一意にする（最上位＝parent_id NULL 同士も一意にするため COALESCE を使う）
CREATE UNIQUE INDEX "storage_locations_sibling_name_key" ON "storage_locations"("household_id", COALESCE("parent_id", ''), "name");

-- 置き場所・タグ付与は消耗品(item)か物(thing)のどちらか一方だけを指す
ALTER TABLE "storage_placements" ADD CONSTRAINT "storage_placements_target_check" CHECK (("item_id" IS NULL) <> ("thing_id" IS NULL));
ALTER TABLE "usage_tag_links" ADD CONSTRAINT "usage_tag_links_target_check" CHECK (("item_id" IS NULL) <> ("thing_id" IS NULL));
