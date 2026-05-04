export const WARNING_CODE = {
  VISUAL_EXACT_NOT_FOUND: 'VISUAL_EXACT_NOT_FOUND',
  VISUAL_NO_CANDIDATE: 'VISUAL_NO_CANDIDATE',
} as const;

export type WarningCode = (typeof WARNING_CODE)[keyof typeof WARNING_CODE];

export function withWarningCode(code: WarningCode, message: string): string {
  return `[${code}] ${message}`;
}

export function readWarningCode(
  warning: string
): WarningCode | null {
  const match = warning.match(/^\[([A-Z0-9_]+)\]\s+/);
  if (!match) {
    return null;
  }

  const code = match[1];
  return Object.values(WARNING_CODE).includes(code as WarningCode) ? (code as WarningCode) : null;
}
