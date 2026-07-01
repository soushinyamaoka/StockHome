/**
 * スプレッドシート（xlsx エクスポート）→ PostgreSQL データ移行スクリプト
 *
 * 使い方:
 *   npx tsx scripts/migrate-from-xlsx.ts [xlsxパス] [オプション]
 *
 * オプション:
 *   --reset                  既存の household データを全削除してから投入する
 *   --candidates-only        import_order_candidates のみ追補する（既存行はスキップ）。
 *                            移行済み DB に対する候補データの再投入・欠損補完用
 *   --admin-email <email>    管理者ユーザーのメール（未指定時は環境変数 ADMIN_EMAIL。
 *                            どちらも無ければ管理者の昇格はスキップ）
 *   --admin-name <name>      管理者ユーザーの表示名（既定: 管理者）。
 *                            既存ユーザーのメールと一致する場合は admin に昇格のみ行う
 *
 * 注意:
 *   - 接続先は DATABASE_URL 環境変数（apps/api/.env）に従う。VPS へ投入する場合は
 *     一時的に DATABASE_URL を切り替えるか、VPS 上で実行する。
 *   - users シートに email 列が無いため、import_order_candidates の
 *     imported_by_user_id × imported_by_email の対応から自動導出する。
 *     導出できないユーザーは <legacy_id>@stockhome.local の仮メールになる
 *     （ログインに使う場合は後で実メールに更新すること）。
 *   - 全ユーザーの初期パスワードは環境変数 INITIAL_PASSWORD（未設定なら 'changeme1234'）。
 *     移行後、各自アプリの「パスワード変更」で変更すること。
 */
import 'dotenv/config';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import * as XLSX from 'xlsx';

const prisma = new PrismaClient();

const DEFAULT_XLSX = process.env.MIGRATION_XLSX ?? 'C:/work/PRG/GAS/StockHome/data/StockHome_Data.xlsx';
const INITIAL_PASSWORD = process.env.INITIAL_PASSWORD ?? 'changeme1234';
const HOUSEHOLD_NAME = '我が家';

// ---------------------------------------------------------------
// 引数処理
// ---------------------------------------------------------------
const args = process.argv.slice(2);
function getOption(name: string, fallback: string): string {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
const xlsxPath = args.find((a) => !a.startsWith('--') && a.endsWith('.xlsx')) ?? DEFAULT_XLSX;
const reset = args.includes('--reset');
const candidatesOnly = args.includes('--candidates-only');
const adminEmail = getOption('--admin-email', process.env.ADMIN_EMAIL ?? '');
const adminName = getOption('--admin-name', '管理者');

// ---------------------------------------------------------------
// 値変換ヘルパー
// ---------------------------------------------------------------

// Excel シリアル値 / ISO 文字列 / JS Date 文字列 が混在する日時を Date に正規化
function toDate(v: unknown): Date | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) return v;
  if (typeof v === 'number') {
    // Excel シリアル値（1900年起点）
    const ms = Math.round((v - 25569) * 86400 * 1000);
    return new Date(ms);
  }
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

// 日付のみ（UTC 0時）に丸める。シリアル値や JST 文字列のカレンダー日付を保持する
function toDateOnly(v: unknown): Date | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') {
    // シリアル値はそのまま日数 → カレンダー日付
    const days = Math.floor(v);
    const base = Date.UTC(1899, 11, 30);
    return new Date(base + days * 86400 * 1000);
  }
  const s = String(v);
  // "Wed Apr 15 2026 00:00:00 GMT+0900" のような JST 文字列はローカル表現の日付を採る
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  // ISO 'YYYY-MM-DD' 先頭ならそれを使う
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  // GMT+0900 等を含む文字列 → JST でのカレンダー日付に補正（+9h して UTC 日付を取る）
  const jst = new Date(d.getTime() + 9 * 3600 * 1000);
  return new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate()));
}

function toBool(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return v.toLowerCase() === 'true';
  return false;
}

function toNum(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isNaN(n) ? null : n;
}

function toStr(v: unknown): string | null {
  if (v == null || v === '') return null;
  return String(v);
}

// ---------------------------------------------------------------
// import_order_candidates の投入
// 重複判定は (mail_message_id, item_name_raw) の組。
// 複数商品を含む1通のメールは商品ごとに行が存在するため message_id 単独では一意でない
// ---------------------------------------------------------------
async function importCandidateRows(
  rows: Record<string, unknown>[],
  householdId: string,
  itemIdByLegacy: Map<string, string>
): Promise<number> {
  const mapItem = (legacy: unknown): string | null =>
    legacy ? itemIdByLegacy.get(String(legacy)) ?? null : null;

  let count = 0;
  for (const row of rows) {
    const mailMessageId = toStr(row['mail_message_id']);
    if (!mailMessageId) continue;
    const mailDate = toDate(row['mail_date']);
    if (!mailDate) continue;
    const itemNameRaw = toStr(row['item_name_raw']);

    const exists = await prisma.importOrderCandidate.findFirst({
      where: { mailMessageId, itemNameRaw },
    });
    if (exists) continue;

    await prisma.importOrderCandidate.create({
      data: {
        householdId,
        legacyId: String(row['candidate_id']),
        vendor: toStr(row['vendor']) ?? 'amazon',
        mailMessageId,
        gmailThreadId: toStr(row['gmail_thread_id']),
        importedByUserId: toStr(row['imported_by_user_id']),
        importedByEmail: toStr(row['imported_by_email']),
        mailDate,
        orderId: toStr(row['order_id']),
        mailType: toStr(row['mail_type']) ?? 'other',
        mailPhase: toStr(row['mail_phase']) ?? 'other',
        fulfillmentStatus: toStr(row['fulfillment_status']),
        candidateGroupKey: toStr(row['candidate_group_key']),
        itemNameRaw,
        detectedQty: toNum(row['detected_qty']),
        detectedPrice: toNum(row['detected_price']),
        candidateStatus: toStr(row['candidate_status']) ?? 'detected',
        matchedItemId: mapItem(row['matched_item_id']),
        rawSubject: toStr(row['raw_subject']),
        rawSnippet: toStr(row['raw_snippet']),
        parseResult: toStr(row['parse_result']),
        createdAt: toDate(row['created_at']) ?? new Date(),
      },
    });
    count++;
  }
  return count;
}

// ---------------------------------------------------------------
// メイン
// ---------------------------------------------------------------
async function main() {
  console.log(`xlsx: ${path.resolve(xlsxPath)}`);
  const wb = XLSX.readFile(xlsxPath);
  const sheet = <T = Record<string, unknown>>(name: string): T[] =>
    wb.SheetNames.includes(name) ? (XLSX.utils.sheet_to_json(wb.Sheets[name]) as T[]) : [];

  const usersRows = sheet('users');
  const itemsRows = sheet('items');
  const purchaseRows = sheet('purchase_log');
  const runtimeRows = sheet('item_runtime_state');
  const notificationRows = sheet('notification_log');
  const candidateRows = sheet('import_order_candidates');
  const correctionRows = sheet('stock_correction_log');
  const configRows = sheet('app_config');

  console.log(
    `読込: users=${usersRows.length}, items=${itemsRows.length}, purchases=${purchaseRows.length}, ` +
      `runtime=${runtimeRows.length}, notifications=${notificationRows.length}, ` +
      `candidates=${candidateRows.length}, corrections=${correctionRows.length}, config=${configRows.length}`
  );

  // --- candidates-only モード: 候補の追補のみ行う ---
  if (candidatesOnly) {
    const existing = await prisma.household.findFirst({ where: { name: HOUSEHOLD_NAME } });
    if (!existing) {
      console.error('中断: household がありません。先に全体移行を実行してください。');
      process.exit(1);
    }
    const items = await prisma.item.findMany({
      where: { householdId: existing.id, legacyId: { not: null } },
    });
    const itemMap = new Map(items.map((i) => [i.legacyId as string, i.id]));
    const n = await importCandidateRows(candidateRows, existing.id, itemMap);
    console.log(`import_order_candidates: ${n} 件追補（既存はスキップ）`);
    return;
  }

  // --- household ---
  let household = await prisma.household.findFirst({ where: { name: HOUSEHOLD_NAME } });
  if (household && reset) {
    console.log('--reset 指定のため既存データを削除します');
    await prisma.household.delete({ where: { id: household.id } }); // cascade で配下全削除
    household = null;
  }
  if (!household) {
    household = await prisma.household.create({ data: { name: HOUSEHOLD_NAME } });
  } else {
    const itemCount = await prisma.item.count({ where: { householdId: household.id } });
    if (itemCount > 0) {
      console.error(
        `中断: household「${HOUSEHOLD_NAME}」に既に ${itemCount} 件の品目があります。` +
          '上書きする場合は --reset を付けてください。'
      );
      process.exit(1);
    }
  }
  const householdId = household.id;

  // --- ユーザーのメール導出（candidates の user_id × email 対応から） ---
  const emailByLegacyUser = new Map<string, string>();
  for (const c of candidateRows) {
    const uid = toStr(c['imported_by_user_id']);
    const email = toStr(c['imported_by_email']);
    if (uid && email && !emailByLegacyUser.has(uid)) emailByLegacyUser.set(uid, email);
  }

  // --- users ---
  const passwordHash = await bcrypt.hash(INITIAL_PASSWORD, 10);
  const userIdByLegacy = new Map<string, string>();

  for (const row of usersRows) {
    const legacyId = String(row['user_id']);
    const email =
      toStr(row['email']) ??
      emailByLegacyUser.get(legacyId) ??
      `${legacyId.toLowerCase()}@stockhome.local`;
    const name = String(row['user_name'] ?? legacyId);
    const role = toStr(row['role']) === 'admin' ? 'admin' : 'member';

    const user = await prisma.user.upsert({
      where: { email },
      create: { email, name, passwordHash, legacyId, isActive: toBool(row['is_active']) },
      update: { legacyId, name },
    });
    await prisma.householdMember.upsert({
      where: { householdId_userId: { householdId, userId: user.id } },
      create: { householdId, userId: user.id, role },
      update: { role },
    });
    userIdByLegacy.set(legacyId, user.id);
    console.log(`user: ${name} <${email}> (${role})`);
  }

  // --- 管理者ユーザー ---
  if (adminEmail) {
    const existing = await prisma.user.findUnique({ where: { email: adminEmail } });
    const admin =
      existing ??
      (await prisma.user.create({
        data: { email: adminEmail, name: adminName, passwordHash },
      }));
    await prisma.householdMember.upsert({
      where: { householdId_userId: { householdId, userId: admin.id } },
      create: { householdId, userId: admin.id, role: 'admin' },
      update: { role: 'admin' },
    });
    console.log(`admin: ${admin.name} <${adminEmail}>`);
  }

  const mapUser = (legacy: unknown): string | null =>
    legacy ? userIdByLegacy.get(String(legacy)) ?? null : null;

  // --- items ---
  const itemIdByLegacy = new Map<string, string>();
  for (const row of itemsRows) {
    const legacyId = String(row['item_id']);
    let alternatives: unknown = [];
    const altRaw = toStr(row['alternatives']);
    if (altRaw) {
      try {
        alternatives = JSON.parse(altRaw);
      } catch {
        console.warn(`  items.alternatives の JSON 解析失敗: ${legacyId}`);
      }
    }
    const item = await prisma.item.create({
      data: {
        householdId,
        legacyId,
        itemName: String(row['item_name']),
        category: toStr(row['category']),
        unit: toStr(row['unit']),
        defaultPurchaseQty: toNum(row['default_purchase_qty']) ?? 1,
        daysPerUnit: toNum(row['days_per_unit']) ?? 1,
        leadDays: Math.round(toNum(row['lead_days']) ?? 0),
        safetyDays: Math.round(toNum(row['safety_days']) ?? 0),
        lowStockThresholdQty: toNum(row['low_stock_threshold_qty']),
        purchaseUrl: toStr(row['purchase_url']),
        alternatives: alternatives as object,
        itemMemo: toStr(row['item_memo']),
        notifyTargetType: toStr(row['notify_target_type']) ?? 'all',
        notifyTargetUserId: mapUser(row['notify_target_user_id']),
        notificationEnabled: toBool(row['notification_enabled']),
        isInventoryUnknown: toBool(row['is_inventory_unknown']),
        isActive: toBool(row['is_active']),
        deletedAt: toDate(row['deleted_at']),
        deletedBy: mapUser(row['deleted_by']),
        createdAt: toDate(row['created_at']) ?? new Date(),
      },
    });
    itemIdByLegacy.set(legacyId, item.id);
  }
  console.log(`items: ${itemIdByLegacy.size} 件投入`);

  const mapItem = (legacy: unknown): string | null =>
    legacy ? itemIdByLegacy.get(String(legacy)) ?? null : null;

  // --- purchase_log ---
  let purchaseCount = 0;
  for (const row of purchaseRows) {
    const itemId = mapItem(row['item_id']);
    if (!itemId) {
      console.warn(`  purchase_log: item_id 不明のためスキップ (${row['purchase_id']})`);
      continue;
    }
    const purchasedAt = toDateOnly(row['purchased_at']);
    if (!purchasedAt) {
      console.warn(`  purchase_log: purchased_at 不明のためスキップ (${row['purchase_id']})`);
      continue;
    }
    await prisma.purchaseLog.create({
      data: {
        householdId,
        legacyId: String(row['purchase_id']),
        itemId,
        purchasedAt,
        qty: toNum(row['qty']) ?? 1,
        price: toNum(row['price']),
        source: toStr(row['source']) ?? 'manual',
        sourceType: toStr(row['source_type']) ?? 'manual',
        externalVendor: toStr(row['external_vendor']),
        externalOrderId: toStr(row['external_order_id']),
        importCandidateId: toStr(row['import_candidate_id']),
        purchasedByUserId: mapUser(row['purchased_by_user_id']),
        purchasedByUserName: toStr(row['purchased_by_user_name']),
        note: toStr(row['note']),
        fulfillmentStatus: toStr(row['fulfillment_status']),
        shippedAt: toDateOnly(row['shipped_at']),
        inventoryEffectiveAt: toDateOnly(row['inventory_effective_at']),
        countedInInventory: toBool(row['counted_in_inventory']),
        createdAt: toDate(row['created_at']) ?? new Date(),
      },
    });
    purchaseCount++;
  }
  console.log(`purchase_log: ${purchaseCount} 件投入`);

  // --- item_runtime_state ---
  let runtimeCount = 0;
  for (const row of runtimeRows) {
    const itemId = mapItem(row['item_id']);
    if (!itemId) continue;
    await prisma.itemRuntimeState.upsert({
      where: { itemId },
      create: {
        householdId,
        itemId,
        manualOverrideQty: toNum(row['manual_override_qty']),
        manualOverrideAt: toDate(row['manual_override_at']),
        manualOverrideByUserId: mapUser(row['manual_override_by_user_id']),
        manualOverrideReason: toStr(row['manual_override_reason']),
        snoozeUntil: toDate(row['snooze_until']),
        lastNotificationReason: toStr(row['last_notification_reason']),
        lastNotificationAt: toDate(row['last_notification_at']),
      },
      update: {},
    });
    runtimeCount++;
  }
  console.log(`item_runtime_state: ${runtimeCount} 件投入`);

  // --- notification_log ---
  let notifCount = 0;
  for (const row of notificationRows) {
    const itemId = mapItem(row['item_id']);
    if (!itemId) continue;
    await prisma.notificationLog.create({
      data: {
        householdId,
        legacyId: String(row['notification_id']),
        itemId,
        notificationType: toStr(row['notification_type']) ?? 'stock_alert',
        notificationReason: toStr(row['notification_reason']) ?? 'days_threshold',
        targetUserId: toStr(row['target_user_id']) ?? 'broadcast',
        message: toStr(row['message']) ?? '',
        createdAt: toDate(row['created_at']) ?? new Date(),
      },
    });
    notifCount++;
  }
  console.log(`notification_log: ${notifCount} 件投入`);

  // --- import_order_candidates ---
  const candCount = await importCandidateRows(candidateRows, householdId, itemIdByLegacy);
  console.log(`import_order_candidates: ${candCount} 件投入`);

  // --- stock_correction_log ---
  let corrCount = 0;
  for (const row of correctionRows) {
    const itemId = mapItem(row['item_id']);
    if (!itemId) continue;
    await prisma.stockCorrectionLog.create({
      data: {
        householdId,
        legacyId: String(row['correction_id']),
        itemId,
        correctedAt: toDate(row['corrected_at']) ?? new Date(),
        correctedByUserId: mapUser(row['corrected_by_user_id']),
        correctedByUserName: toStr(row['corrected_by_user_name']),
        beforeEstimatedQty: toNum(row['before_estimated_qty']),
        correctedQty: toNum(row['corrected_qty']) ?? 0,
        correctionReason: toStr(row['correction_reason']) ?? 'manual_adjustment',
        note: toStr(row['note']),
        createdAt: toDate(row['created_at']) ?? new Date(),
      },
    });
    corrCount++;
  }
  console.log(`stock_correction_log: ${corrCount} 件投入`);

  // --- app_config ---
  for (const row of configRows) {
    const key = toStr(row['config_key']);
    if (!key) continue;
    await prisma.appConfig.upsert({
      where: { householdId_key: { householdId, key } },
      create: { householdId, key, value: String(row['config_value'] ?? '') },
      update: { value: String(row['config_value'] ?? '') },
    });
  }
  console.log(`app_config: ${configRows.length} 件投入`);

  // --- 在庫再計算（stock_snapshot は移行せず再生成する） ---
  const { updateCountedInInventory, recalculateAllStocks } = await import(
    '../src/services/stockCalc'
  );
  const counted = await updateCountedInInventory(householdId);
  const stocks = await recalculateAllStocks(householdId);
  console.log(`在庫再計算: counted更新=${counted}, snapshot=${stocks.length} 件`);

  console.log('=== 移行完了 ===');
  console.log(`初期パスワード: ${INITIAL_PASSWORD}（全ユーザー共通。ログイン後の変更を推奨）`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
