export function normalizeCronExpression(expression: string): string {
  const trimmed = expression.trim();
  if (trimmed.startsWith('@')) {
    return trimmed;
  }

  const parts = trimmed.split(/\s+/);
  if (parts.length === 5) {
    return `0 ${trimmed}`;
  }

  return trimmed;
}
