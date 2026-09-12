export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

export function parsePositiveIntParam(
  value: unknown,
  { defaultValue, max }: { defaultValue: number; max?: number },
): number | undefined {
  if (value === undefined) {
    return defaultValue;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return undefined;
  }
  return max ? Math.min(parsed, max) : parsed;
}

export function parsePagination(
  query: Record<string, unknown>,
): { page: number; limit: number } | undefined {
  const page = parsePositiveIntParam(query.page, { defaultValue: 1 });
  const limit = parsePositiveIntParam(query.limit, { defaultValue: DEFAULT_LIMIT, max: MAX_LIMIT });
  if (page === undefined || limit === undefined) {
    return undefined;
  }
  return { page, limit };
}
