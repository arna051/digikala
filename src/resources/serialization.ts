export function serializeListQuery(
  input: {
    page: number;
    size: number;
    sort: string;
    order?: string;
    search?: Record<string, unknown>;
  },
  searchKeyAliases: Record<string, string> = {},
): Record<string, unknown> {
  const params: Record<string, unknown> = {
    page: input.page,
    size: input.size,
    sort: input.sort,
  };
  if (input.order !== undefined) params.order = input.order;
  for (const [key, value] of Object.entries(input.search ?? {})) {
    if (value === undefined) continue;
    const apiKey = searchKeyAliases[key] ?? toSnakeCase(key);
    params[`search[${apiKey}]`] = Array.isArray(value)
      ? serializeArraySearch(key, value)
      : value;
  }
  return params;
}

function toSnakeCase(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function serializeArraySearch(key: string, values: unknown[]): string {
  return key === 'ids' ? values.join('_') : values.join(',');
}
