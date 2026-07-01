import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '../lib/prisma';
import { serializeItem, serializeSnapshot, serializeRuntimeState } from '../utils/serialize';
import { todayDateOnly } from '../services/stockCalc';
import { runDailyBatch } from '../services/batch';
import { candidateOwnerFilter } from './importCandidates';

const dashboardRoutes: FastifyPluginAsync = async (app) => {
  // ホーム画面用サマリ
  app.get('/', async (req) => {
    const { householdId, userId, role } = req.auth;

    const items = await prisma.item.findMany({
      where: { householdId, isActive: true },
      include: { stockSnapshot: true, runtimeState: true },
    });

    // アラート品目のフィルタ。夜間バッチ(LINE通知)の抑止条件とホーム表示を揃える:
    //   - 通知OFF の品目は出さない
    //   - スヌーズ中（snooze_until が未来）は出さない
    //   - notify_target_type でユーザー別フィルタ（GAS 30.2 準拠）
    //     all → 全員 / representative → admin のみ / specific_user → 指定ユーザーのみ
    const now = new Date();
    const alerts = items
      .filter((item) => {
        const s = item.stockSnapshot;
        if (!s || !s.alertNeeded || s.estimatedRemainingQty == null) return false;
        if (!item.notificationEnabled) return false;
        const snoozeUntil = item.runtimeState?.snoozeUntil;
        if (snoozeUntil && snoozeUntil > now) return false;
        if (item.notifyTargetType === 'representative') return role === 'admin';
        if (item.notifyTargetType === 'specific_user') return item.notifyTargetUserId === userId;
        return true;
      })
      .sort(
        (a, b) =>
          (a.stockSnapshot?.estimatedDaysLeft ?? 0) - (b.stockSnapshot?.estimatedDaysLeft ?? 0)
      )
      .map((item) => ({
        item: serializeItem(item),
        snapshot: serializeSnapshot(item.stockSnapshot!),
        runtimeState: serializeRuntimeState(item.runtimeState),
      }));

    // ホームは上位のみ表示（GAS 版 getAlertStocks の slice(0,5) 準拠）。
    // 総件数は alertTotal で返し、画面で「他N件」を出せるようにする
    const HOME_ALERT_LIMIT = 5;
    const alertTotal = alerts.length;
    const topAlerts = alerts.slice(0, HOME_ALERT_LIMIT);

    // 未確認の自動取込候補件数（detected / ordered / shipped、自分の候補のみ）
    const ownerFilter = await candidateOwnerFilter(userId);
    const pendingCandidates = await prisma.importOrderCandidate.count({
      where: {
        householdId,
        ...ownerFilter,
        candidateStatus: { in: ['detected', 'ordered', 'shipped'] },
      },
    });

    // 今日の通知件数
    const today = todayDateOnly();
    const todayNotifications = await prisma.notificationLog.count({
      where: { householdId, createdAt: { gte: today } },
    });

    return {
      alerts: topAlerts,
      alertTotal,
      pendingCandidates,
      todayNotifications,
      totalActiveItems: items.length,
    };
  });

  // 夜間バッチの手動実行（admin のみ。検証・再実行用）
  app.post('/run-batch', async (req, reply) => {
    if (req.auth.role !== 'admin') {
      return reply.code(403).send({ message: '管理者のみ実行できます' });
    }
    const result = await runDailyBatch();
    return result;
  });
};

export default dashboardRoutes;
