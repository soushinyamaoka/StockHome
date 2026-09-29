export function isUnresolvedCandidateStatus(status: string): boolean {
  return ['detected', 'ordered', 'shipped'].includes(status);
}

export function selectableCandidateIds(
  candidates: { id: string; candidateStatus: string }[],
): string[] {
  return candidates.filter((candidate) => isUnresolvedCandidateStatus(candidate.candidateStatus)).map((candidate) => candidate.id);
}

export function effectiveSelection(selected: ReadonlySet<string>, selectableIds: string[]): string[] {
  return selectableIds.filter((id) => selected.has(id));
}

export async function runBulkIgnore(
  ids: string[],
  ignoreOne: (id: string) => Promise<unknown>,
): Promise<{ succeeded: string[]; failed: string[] }> {
  const succeeded: string[] = [];
  const failed: string[] = [];
  for (const id of ids) {
    try {
      await ignoreOne(id);
      succeeded.push(id);
    } catch {
      failed.push(id);
    }
  }
  return { succeeded, failed };
}
