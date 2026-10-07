export type InitialQtyParse =
  | { kind: 'empty' }
  | { kind: 'value'; value: number }
  | { kind: 'invalid' };

export function parseInitialQty(text: string): InitialQtyParse {
  const trimmed = text.trim();
  if (trimmed === '') return { kind: 'empty' };
  const value = Number(trimmed);
  return Number.isFinite(value) && value >= 0 ? { kind: 'value', value } : { kind: 'invalid' };
}

export function itemSavedAlert(opts: {
  isEdit: boolean;
  itemName: string;
  returnToCandidate: boolean;
  initialQtySaved: boolean;
  initialQtyFailed: boolean;
}): { title: string; message: string } {
  if (opts.isEdit) return { title: '保存完了', message: '消耗品を更新しました' };

  const messages = ['消耗品を登録しました'];
  if (opts.initialQtySaved) messages.push('いまの数から在庫の予測を始めます');
  if (opts.initialQtyFailed) {
    messages.push('手元の数は保存できませんでした。在庫画面の「在庫のなおし」から入れてください');
  }
  if (opts.returnToCandidate) {
    messages.push(`取込便に戻り、「${opts.itemName}」を選んだ状態にします`);
  }
  return { title: '保存完了', message: messages.join('\n') };
}
