// 端末で動いている版を利用者が確かめられるよう、設定画面に表示する。
// client release（ops/client-releases/）を配信するたびに、その番号と配信日へ更新する
export const CLIENT_RELEASE = { number: '016', deliveredOn: '2026-11-06' } as const;

export function clientReleaseLabel(): string {
  const [, month, day] = CLIENT_RELEASE.deliveredOn.split('-');
  return `${CLIENT_RELEASE.number}（${Number(month)}/${Number(day)}配信）`;
}
