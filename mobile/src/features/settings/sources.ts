import type { SourceHealth } from '@rack/shared/types';

import type { Palette } from '@/theme/colors';

export const STATUS_LABEL: Record<SourceHealth['status'], string> = {
  ok: 'Working',
  degraded: 'Recent errors',
  down: 'Failing',
  blocked: 'Blocked by site',
  not_configured: 'Not set up',
  never_run: 'Waiting for first run',
};

/** Dot colour for a source (the web's SourcesButton). */
export function statusColor(h: Pick<SourceHealth, 'status' | 'usage_warning'>, c: Palette): string {
  if (h.usage_warning && h.status === 'ok') return c.warning;
  if (h.status === 'ok') return c.accent;
  if (h.status === 'degraded') return c.warning;
  if (h.status === 'down' || h.status === 'blocked') return c.danger;
  return c.subtle;
}

/** One dot for all sources: warning if any is struggling, accent if any works, else grey. */
export function overallColor(all: SourceHealth[] | undefined, c: Palette): string {
  if (!all?.length) return c.subtle;
  if (all.some((h) => h.status === 'down' || h.status === 'degraded')) return c.warning;
  return all.some((h) => h.status === 'ok') ? c.accent : c.subtle;
}
