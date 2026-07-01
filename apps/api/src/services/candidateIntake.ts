// Gmail 取込候補のインテイク処理
// GAS 版 GmailImportService の「保存以降」のロジックを移植:
//   - 重複排除（仕様書 Section 10.5 の3段階）
//   - mail_phase に応じた candidate_status / fulfillment_status の決定
//   - 発送メール受信時の ordered → shipped 昇格
//   - 品名部分一致による自動確定（1件一致時のみ）
//   - 候補確定時の purchase_log 反映（Section 11.3, 11.4）
import type { ImportOrderCandidate, Prisma } from '@prisma/client';
import { APP_CONFIG_KEYS, DEFAULTS, type BridgeCandidate } from '@stockhome/shared';
import { prisma } from '../lib/prisma';
import { refreshStockSnapshotForItem, todayDateOnly } from './stockCalc';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

// メール日時の「JST カレンダー日付」を UTC 0時の Date で返す。
// GAS は mailDate.toISOString()（UTC）で送ってくるため、UTC の年月日で切ると
// JST 早朝(0–8時台)のメールが前日扱いになる。+9h してから日付を取り JST 基準に揃える。
function jstDateOnly(d: Date): Date {
  const jst = new Date(d.getTime() + JST_OFFSET_MS);
  return new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate()));
}

// 取込候補の数量換算（過大カウント防止ガード付き）。
// モデル: detected_qty=「セット数」, default_purchase_qty=「1セットの個数」→ qty = セット数 × 個数。
// パーサーが「24缶」等の個数をセット数として拾うと 24×24=576 のような過大値になるため、
// 1注文明細としてあり得ないセット数（MAX_PLAUSIBLE_SETS 超）は取り違えとみなし 1 セット扱いにする。
const MAX_PLAUSIBLE_SETS = 12;
function resolvePurchaseQty(detectedQty: number | null, defaultPurchaseQty: number) {
  const unitsPerSet = Math.max(1, Math.round(defaultPurchaseQty));
  const rawSets = Math.max(1, Math.round(detectedQty ?? 1));
  const suspicious = rawSets > MAX_PLAUSIBLE_SETS;
  const sets = suspicious ? 1 : rawSets;
  return { qty: sets * unitsPerSet, sets, rawSets, unitsPerSet, suspicious };
}

async function getDeliveryBufferDays(householdId: string): Promise<number> {
  const config = await prisma.appConfig.findUnique({
    where: {
      householdId_key: { householdId, key: APP_CONFIG_KEYS.DELIVERY_BUFFER_DAYS },
    },
  });
  const n = config ? parseInt(config.value, 10) : NaN;
  return Number.isNaN(n) ? DEFAULTS.DELIVERY_BUFFER_DAYS : n;
}

// 候補から purchase_log を作成する（GAS createPurchaseLogFromImportCandidate 相当）
// - qty は detected_qty(セット数) × default_purchase_qty(個数) に換算
// - inventory_effective_at = メール日付 + 配送バッファ日数
export async function createPurchaseLogFromCandidate(
  candidate: ImportOrderCandidate,
  matchedItemId: string,
  confirmedByUserId: string | null,
  sourceType: 'gmail_auto' | 'gmail_auto_confirmed'
) {
  const item = await prisma.item.findFirst({
    where: { id: matchedItemId, householdId: candidate.householdId, isActive: true },
  });
  if (!item) {
    throw Object.assign(new Error('品目が見つからないか削除済みです'), { statusCode: 404 });
  }

  const { qty, suspicious, rawSets, unitsPerSet } = resolvePurchaseQty(
    candidate.detectedQty,
    item.defaultPurchaseQty
  );

  const bufferDays = await getDeliveryBufferDays(candidate.householdId);
  const mailDate = jstDateOnly(candidate.mailDate);
  const inventoryEffectiveAt = new Date(mailDate.getTime() + bufferDays * MS_PER_DAY);
  const counted = inventoryEffectiveAt <= todayDateOnly();

  const baseNote = `自動取込: ${candidate.itemNameRaw ?? ''}`;
  const note = suspicious
    ? `${baseNote}（数量要確認: 検出${rawSets}×${unitsPerSet}→1セット扱い）`
    : baseNote;

  const user = confirmedByUserId
    ? await prisma.user.findUnique({ where: { id: confirmedByUserId } })
    : null;

  const log = await prisma.purchaseLog.create({
    data: {
      householdId: candidate.householdId,
      itemId: matchedItemId,
      purchasedAt: mailDate,
      qty,
      price: candidate.detectedPrice ?? null,
      source: 'gmail',
      sourceType,
      externalVendor: candidate.vendor,
      externalOrderId: candidate.orderId,
      importCandidateId: candidate.id,
      purchasedByUserId: confirmedByUserId,
      purchasedByUserName: user?.name ?? null,
      note,
      fulfillmentStatus: candidate.fulfillmentStatus ?? 'shipped',
      shippedAt: mailDate,
      inventoryEffectiveAt,
      countedInInventory: counted,
    },
  });

  if (counted) {
    await refreshStockSnapshotForItem(matchedItemId);
  }
  return log;
}

// 商品名/品名の正規化（小文字化・連続空白の圧縮・前後空白除去）
function normalizeName(raw: string | null): string {
  if (!raw) return '';
  return raw.replace(/\s+/g, ' ').trim().toLowerCase();
}

// 品名部分一致でアクティブ品目を検索（GAS findItemsByPartialMatch 相当）
async function findItemsByPartialMatch(householdId: string, rawName: string | null) {
  const normalized = normalizeName(rawName);
  if (normalized.length < 2) return [];

  const items = await prisma.item.findMany({
    where: { householdId, isActive: true },
  });
  return items.filter((item) => {
    const name = item.itemName.toLowerCase();
    return normalized.includes(name) || name.includes(normalized);
  });
}

// 学習型マッピング: 過去にユーザーが（手動 or 自動で）同じ商品名を紐付けた品目を引く。
// 部分一致は語順や表記の差に弱い（例: 在庫「アサヒ ドライゼロ」 vs メール「ドライゼロ アサヒ」）ため、
// 一度確定した item_name_raw → matched_item の対応を household 単位の学習として再利用する。
// 家族で共有される知識なので vendor 非依存。アクティブ品目のみ、曖昧（複数品目）なら null。
async function findLearnedItemMapping(householdId: string, itemNameRaw: string | null) {
  const key = normalizeName(itemNameRaw);
  if (key.length < 2) return null;

  const priors = await prisma.importOrderCandidate.findMany({
    where: {
      householdId,
      candidateStatus: { in: ['confirmed', 'auto_confirmed'] },
      matchedItemId: { not: null },
    },
    select: { itemNameRaw: true, matchedItemId: true },
  });

  const ids = new Set(
    priors.filter((p) => normalizeName(p.itemNameRaw) === key).map((p) => p.matchedItemId!)
  );
  if (ids.size === 0) return null;

  const items = await prisma.item.findMany({
    where: { id: { in: [...ids] }, householdId, isActive: true },
  });
  // 同じ商品名が複数のアクティブ品目に割れている場合は曖昧として自動反映しない（誤反映防止）
  return items.length === 1 ? items[0] : null;
}

// 候補の自動確定を試みる（新規取込・ordered→shipped 昇格の両方から呼ぶ）。
//   対象品目決定: ①学習型マッピング → ②品名の部分一致1件
//   数量が不審（セット数取り違えの疑い）なら自動反映せず手動確認に回す
async function tryAutoConfirmCandidate(
  candidate: ImportOrderCandidate,
  importedByEmail: string | null | undefined,
  result: IntakeResult
) {
  if (['confirmed', 'auto_confirmed', 'ignored'].includes(candidate.candidateStatus)) return;

  let target = await findLearnedItemMapping(candidate.householdId, candidate.itemNameRaw);
  let note = '自動確定（学習: 過去の紐付けと一致）';
  let multiSkip: string | null = null;
  if (!target) {
    const matches = await findItemsByPartialMatch(candidate.householdId, candidate.itemNameRaw);
    if (matches.length === 1) {
      target = matches[0];
      note = '自動確定（部分一致1件）';
    } else if (matches.length > 1) {
      multiSkip = `自動確定スキップ: 複数一致 (${matches.map((m) => m.itemName).join(', ')})`;
    }
  }

  if (target) {
    // 数量が不審なら自動反映せず手動確認へ（過大カウント防止）
    const { suspicious, rawSets } = resolvePurchaseQty(candidate.detectedQty, target.defaultPurchaseQty);
    if (suspicious) {
      await prisma.importOrderCandidate.update({
        where: { id: candidate.id },
        data: { parseResult: `自動確定保留: 数量要確認（検出セット数 ${rawSets}）。手動で確認してください` },
      });
      return;
    }
    const confirmedUser = importedByEmail
      ? await prisma.user.findUnique({ where: { email: importedByEmail } })
      : null;
    await createPurchaseLogFromCandidate(
      candidate,
      target.id,
      confirmedUser?.id ?? null,
      'gmail_auto_confirmed'
    );
    await prisma.importOrderCandidate.update({
      where: { id: candidate.id },
      data: { candidateStatus: 'auto_confirmed', matchedItemId: target.id, parseResult: note },
    });
    result.autoConfirmed++;
  } else if (multiSkip) {
    await prisma.importOrderCandidate.update({
      where: { id: candidate.id },
      data: { parseResult: multiSkip },
    });
  }
}

export interface IntakeResult {
  received: number;
  saved: number;
  duplicates: number;
  upgraded: number;
  autoConfirmed: number;
  errors: number;
}

// GAS ブリッジから届いた候補バッチを処理する
export async function processBridgeCandidates(
  candidates: BridgeCandidate[]
): Promise<IntakeResult> {
  const result: IntakeResult = {
    received: candidates.length,
    saved: 0,
    duplicates: 0,
    upgraded: 0,
    autoConfirmed: 0,
    errors: 0,
  };

  for (const c of candidates) {
    try {
      await processSingleCandidate(c, result);
    } catch (e) {
      result.errors++;
      console.error('[candidateIntake] 候補処理失敗:', c.mailMessageId, e);
    }
  }
  return result;
}

async function resolveHouseholdId(importedByEmail: string | undefined): Promise<string | null> {
  if (importedByEmail) {
    const user = await prisma.user.findUnique({
      where: { email: importedByEmail },
      include: { memberships: { orderBy: { createdAt: 'asc' }, take: 1 } },
    });
    if (user?.memberships[0]) return user.memberships[0].householdId;
  }
  // フォールバック: 最初の household（単一家庭運用前提）
  const household = await prisma.household.findFirst({ orderBy: { createdAt: 'asc' } });
  return household?.id ?? null;
}

async function processSingleCandidate(c: BridgeCandidate, result: IntakeResult) {
  // 重複排除 1: mail_message_id + item_name_raw
  // （複数商品を含む1通のメールは商品ごとに候補が来るため、message_id 単独では判定しない）
  const byMessageId = await prisma.importOrderCandidate.findFirst({
    where: { mailMessageId: c.mailMessageId, itemNameRaw: c.itemNameRaw ?? null },
  });
  if (byMessageId) {
    result.duplicates++;
    return;
  }

  const householdId = await resolveHouseholdId(c.importedByEmail);
  if (!householdId) {
    throw new Error('household が見つかりません');
  }

  // 重複排除/昇格 2: vendor + order_id + item_name_raw が一致する既存候補がある場合
  //   - 確定/無視済み → 真の重複（スキップ）
  //   - 発送メールで既存が未発送(detected/ordered) → 同じ行を shipped に昇格して再評価
  //     （新規行を作らない。これにより「注文→発送」の重複行や二重反映を防ぐ）
  //   - それ以外（同状態の再送など）→ 重複スキップ
  if (c.orderId && c.itemNameRaw) {
    const existing = await prisma.importOrderCandidate.findFirst({
      where: { householdId, vendor: c.vendor, orderId: c.orderId, itemNameRaw: c.itemNameRaw },
    });
    if (existing) {
      const resolved = ['confirmed', 'auto_confirmed', 'ignored'].includes(existing.candidateStatus);
      if (!resolved && c.mailPhase === 'shipped' && existing.candidateStatus !== 'shipped') {
        const upgraded = await prisma.importOrderCandidate.update({
          where: { id: existing.id },
          data: {
            candidateStatus: 'shipped',
            fulfillmentStatus: 'shipped',
            mailPhase: 'shipped',
            mailMessageId: c.mailMessageId,
            mailDate: new Date(c.mailDate),
            detectedQty: c.detectedQty ?? existing.detectedQty,
            detectedPrice: c.detectedPrice ?? existing.detectedPrice,
          },
        });
        result.upgraded++;
        await tryAutoConfirmCandidate(upgraded, c.importedByEmail, result);
        return;
      }
      result.duplicates++;
      return;
    }
  }

  const mailDate = new Date(c.mailDate);

  // 重複排除 3: vendor + imported_by_email + mail_date(日付) + raw_subject
  // （order_id が取れないメールのフォールバック）
  if (!c.orderId && c.rawSubject) {
    const dayStart = jstDateOnly(mailDate);
    const dayEnd = new Date(dayStart.getTime() + MS_PER_DAY);
    const dup = await prisma.importOrderCandidate.findFirst({
      where: {
        vendor: c.vendor,
        importedByEmail: c.importedByEmail ?? null,
        rawSubject: c.rawSubject.substring(0, 300),
        mailDate: { gte: dayStart, lt: dayEnd },
      },
    });
    if (dup) {
      result.duplicates++;
      return;
    }
  }

  // candidate_status / fulfillment_status の決定（Section 10.6）
  const candidateStatus =
    c.mailPhase === 'ordered' ? 'ordered' : c.mailPhase === 'shipped' ? 'shipped' : 'detected';
  const fulfillmentStatus = c.mailPhase === 'shipped' ? 'shipped' : 'ordered';

  const groupKey = `${c.vendor}|${c.orderId || c.mailMessageId}|${c.itemNameRaw || ''}`;

  const saved = await prisma.importOrderCandidate.create({
    data: {
      householdId,
      vendor: c.vendor,
      mailMessageId: c.mailMessageId,
      gmailThreadId: c.gmailThreadId ?? null,
      importedByEmail: c.importedByEmail ?? null,
      mailDate,
      orderId: c.orderId ?? null,
      mailType: c.mailType,
      mailPhase: c.mailPhase,
      fulfillmentStatus,
      candidateGroupKey: groupKey,
      itemNameRaw: c.itemNameRaw ?? null,
      detectedQty: c.detectedQty ?? 1,
      detectedPrice: c.detectedPrice ?? null,
      candidateStatus,
      rawSubject: c.rawSubject?.substring(0, 300) ?? null,
      rawSnippet: c.rawSnippet?.substring(0, 200) ?? null,
      parseResult: c.parseResult ?? null,
    },
  });
  result.saved++;

  // 自動確定を試みる（学習型マッピング → 部分一致1件、数量ガード込み）
  await tryAutoConfirmCandidate(saved, c.importedByEmail, result);
}
