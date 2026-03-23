import type { Platform } from '@autom/contracts';

export const PLATFORM_ORDER: Platform[] = ['local', 'youtube', 'tiktok', 'facebook'];

export function formatPlatformLabel(platform: Platform): string {
  switch (platform) {
    case 'local':
      return 'Local Archive';
    case 'youtube':
      return 'YouTube';
    case 'tiktok':
      return 'TikTok';
    case 'facebook':
      return 'Facebook Pages';
  }
}
