export function formatCachedAt(updatedAtMs: number): string {
  const date = new Date(updatedAtMs);
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${minutes}`;
}
