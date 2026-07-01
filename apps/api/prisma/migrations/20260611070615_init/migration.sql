-- CreateTable
CREATE TABLE "households" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "households_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "legacy_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "household_members" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "household_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "items" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "legacy_id" TEXT,
    "item_name" TEXT NOT NULL,
    "category" TEXT,
    "unit" TEXT,
    "default_purchase_qty" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "days_per_unit" DOUBLE PRECISION NOT NULL,
    "lead_days" INTEGER NOT NULL DEFAULT 0,
    "safety_days" INTEGER NOT NULL DEFAULT 0,
    "low_stock_threshold_qty" DOUBLE PRECISION,
    "purchase_url" TEXT,
    "alternatives" JSONB NOT NULL DEFAULT '[]',
    "item_memo" TEXT,
    "notify_target_type" TEXT NOT NULL DEFAULT 'all',
    "notify_target_user_id" TEXT,
    "notification_enabled" BOOLEAN NOT NULL DEFAULT true,
    "is_inventory_unknown" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_logs" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "legacy_id" TEXT,
    "item_id" TEXT NOT NULL,
    "purchased_at" DATE NOT NULL,
    "qty" DOUBLE PRECISION NOT NULL,
    "price" DOUBLE PRECISION,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "source_type" TEXT NOT NULL DEFAULT 'manual',
    "external_vendor" TEXT,
    "external_order_id" TEXT,
    "import_candidate_id" TEXT,
    "purchased_by_user_id" TEXT,
    "purchased_by_user_name" TEXT,
    "note" TEXT,
    "fulfillment_status" TEXT,
    "shipped_at" DATE,
    "inventory_effective_at" DATE,
    "counted_in_inventory" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_snapshots" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "calculated_at" TIMESTAMP(3) NOT NULL,
    "latest_purchase_date" DATE,
    "latest_purchase_qty" DOUBLE PRECISION,
    "estimated_remaining_qty" DOUBLE PRECISION,
    "estimated_days_left" DOUBLE PRECISION,
    "predicted_out_of_stock_date" DATE,
    "low_stock_threshold_qty" DOUBLE PRECISION,
    "days_alert_needed" BOOLEAN NOT NULL DEFAULT false,
    "qty_alert_needed" BOOLEAN NOT NULL DEFAULT false,
    "alert_needed" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_runtime_states" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "manual_override_qty" DOUBLE PRECISION,
    "manual_override_at" TIMESTAMP(3),
    "manual_override_by_user_id" TEXT,
    "manual_override_reason" TEXT,
    "snooze_until" TIMESTAMP(3),
    "last_notification_reason" TEXT,
    "last_notification_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "item_runtime_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_logs" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "legacy_id" TEXT,
    "item_id" TEXT NOT NULL,
    "notification_type" TEXT NOT NULL,
    "notification_reason" TEXT NOT NULL,
    "target_user_id" TEXT NOT NULL DEFAULT 'broadcast',
    "message" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_order_candidates" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "legacy_id" TEXT,
    "vendor" TEXT NOT NULL,
    "mail_message_id" TEXT NOT NULL,
    "gmail_thread_id" TEXT,
    "imported_by_user_id" TEXT,
    "imported_by_email" TEXT,
    "mail_date" TIMESTAMP(3) NOT NULL,
    "order_id" TEXT,
    "mail_type" TEXT NOT NULL,
    "mail_phase" TEXT NOT NULL,
    "fulfillment_status" TEXT,
    "candidate_group_key" TEXT,
    "item_name_raw" TEXT,
    "detected_qty" DOUBLE PRECISION,
    "detected_price" DOUBLE PRECISION,
    "candidate_status" TEXT NOT NULL DEFAULT 'detected',
    "matched_item_id" TEXT,
    "raw_subject" TEXT,
    "raw_snippet" TEXT,
    "parse_result" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_order_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_correction_logs" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "legacy_id" TEXT,
    "item_id" TEXT NOT NULL,
    "corrected_at" TIMESTAMP(3) NOT NULL,
    "corrected_by_user_id" TEXT,
    "corrected_by_user_name" TEXT,
    "before_estimated_qty" DOUBLE PRECISION,
    "corrected_qty" DOUBLE PRECISION NOT NULL,
    "correction_reason" TEXT NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_correction_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_configs" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_legacy_id_key" ON "users"("legacy_id");

-- CreateIndex
CREATE INDEX "household_members_user_id_idx" ON "household_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "household_members_household_id_user_id_key" ON "household_members"("household_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "items_legacy_id_key" ON "items"("legacy_id");

-- CreateIndex
CREATE INDEX "items_household_id_idx" ON "items"("household_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_logs_legacy_id_key" ON "purchase_logs"("legacy_id");

-- CreateIndex
CREATE INDEX "purchase_logs_household_id_idx" ON "purchase_logs"("household_id");

-- CreateIndex
CREATE INDEX "purchase_logs_item_id_counted_in_inventory_inventory_effect_idx" ON "purchase_logs"("item_id", "counted_in_inventory", "inventory_effective_at");

-- CreateIndex
CREATE UNIQUE INDEX "stock_snapshots_item_id_key" ON "stock_snapshots"("item_id");

-- CreateIndex
CREATE INDEX "stock_snapshots_household_id_idx" ON "stock_snapshots"("household_id");

-- CreateIndex
CREATE UNIQUE INDEX "item_runtime_states_item_id_key" ON "item_runtime_states"("item_id");

-- CreateIndex
CREATE INDEX "item_runtime_states_household_id_idx" ON "item_runtime_states"("household_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_logs_legacy_id_key" ON "notification_logs"("legacy_id");

-- CreateIndex
CREATE INDEX "notification_logs_household_id_created_at_idx" ON "notification_logs"("household_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "import_order_candidates_legacy_id_key" ON "import_order_candidates"("legacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "import_order_candidates_mail_message_id_key" ON "import_order_candidates"("mail_message_id");

-- CreateIndex
CREATE INDEX "import_order_candidates_household_id_candidate_status_idx" ON "import_order_candidates"("household_id", "candidate_status");

-- CreateIndex
CREATE INDEX "import_order_candidates_vendor_order_id_idx" ON "import_order_candidates"("vendor", "order_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_correction_logs_legacy_id_key" ON "stock_correction_logs"("legacy_id");

-- CreateIndex
CREATE INDEX "stock_correction_logs_household_id_idx" ON "stock_correction_logs"("household_id");

-- CreateIndex
CREATE INDEX "stock_correction_logs_item_id_idx" ON "stock_correction_logs"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "app_configs_household_id_key_key" ON "app_configs"("household_id", "key");

-- AddForeignKey
ALTER TABLE "household_members" ADD CONSTRAINT "household_members_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "household_members" ADD CONSTRAINT "household_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_logs" ADD CONSTRAINT "purchase_logs_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_logs" ADD CONSTRAINT "purchase_logs_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_snapshots" ADD CONSTRAINT "stock_snapshots_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_snapshots" ADD CONSTRAINT "stock_snapshots_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_runtime_states" ADD CONSTRAINT "item_runtime_states_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_runtime_states" ADD CONSTRAINT "item_runtime_states_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_order_candidates" ADD CONSTRAINT "import_order_candidates_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_order_candidates" ADD CONSTRAINT "import_order_candidates_matched_item_id_fkey" FOREIGN KEY ("matched_item_id") REFERENCES "items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_correction_logs" ADD CONSTRAINT "stock_correction_logs_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_correction_logs" ADD CONSTRAINT "stock_correction_logs_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_configs" ADD CONSTRAINT "app_configs_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;
