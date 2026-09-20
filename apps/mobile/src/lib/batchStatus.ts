export interface LastBatchRun {
  status: 'success' | 'failure';
  ranAt: string;
  ageHours: number;
}

export function formatJstTime(ranAt: string): string {
  return new Date(ranAt).toLocaleTimeString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
}

// バナーに表示するメッセージ。表示不要なら null を返す。
export function resolveBatchStatusMessage(lastBatchRun: LastBatchRun | null): string | null {
  if (!lastBatchRun) return null;
  const isFailure = lastBatchRun.status === 'failure';
  const isStale = lastBatchRun.status === 'success' && lastBatchRun.ageHours > 26;
  if (!isFailure && !isStale) return null;
  const time = formatJstTime(lastBatchRun.ranAt);
  return isFailure
    ? `夜間バッチが失敗しました（${time}実行）`
    : `バッチの実行が確認できません（前回${time}）`;
}
