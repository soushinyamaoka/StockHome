export function localDateStr(d: Date = new Date()): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function quickPurchaseQty(defaultPurchaseQty: number): number {
  return Number.isFinite(defaultPurchaseQty) && defaultPurchaseQty >= 1 ? defaultPurchaseQty : 1;
}

export function stepQuickPurchaseQty(current: number, delta: 1 | -1): number {
  const base = Number.isFinite(current) ? current : 1;
  return Math.max(1, base + delta);
}

export function buildQuickPurchaseInput(
  item: { id: string; defaultPurchaseQty: number },
  today: Date = new Date()
): { itemId: string; purchasedAt: string; qty: number } {
  return {
    itemId: item.id,
    purchasedAt: localDateStr(today),
    qty: quickPurchaseQty(item.defaultPurchaseQty),
  };
}

export function quickPurchaseMessage(itemName: string, qty: number, unit: string | null | undefined): string {
  return unit ? `「${itemName}」を ${qty}${unit} 記録しました` : `「${itemName}」を ${qty} つ記録しました`;
}
