// 'YYYY-MM-DD' 文字列 → Date (UTCの00:00)。空・不正値は null
export function parseDateOnly(s: string | null | undefined): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  return new Date(`${s}T00:00:00.000Z`);
}

// Date → 'YYYY-MM-DD'
export function formatDateOnly(d: Date | null | undefined): string | null {
  if (!d) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

// 任意の日時の「JST カレンダー日付」を UTC 0時の Date で返す。
// getTime()（UTCミリ秒）に固定オフセットを足してからUTC getterで日付を取るため、
// 実行プロセスの TZ 環境変数やホストのタイムゾーン設定に一切依存しない。
// DB の date 型は UTC 0時で保持しているため、比較はこの形式で揃える。
export function jstDateOnly(d: Date): Date {
  const jst = new Date(d.getTime() + JST_OFFSET_MS);
  return new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate()));
}
