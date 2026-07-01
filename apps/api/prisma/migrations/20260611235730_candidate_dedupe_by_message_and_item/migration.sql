-- DropIndex
DROP INDEX "import_order_candidates_mail_message_id_key";

-- CreateIndex
CREATE INDEX "import_order_candidates_mail_message_id_idx" ON "import_order_candidates"("mail_message_id");
