import type { Hunt } from '@rack/shared/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { Alert } from 'react-native';

import { useToast } from '@/components/Toast';
import { useSession } from '@/lib/auth';

/** Run now, pause/resume, mute/unmute, edit and delete for one hunt (the web's hunt menu). */
export function useHuntActions(hunt: Hunt) {
  const api = useSession().api();
  const qc = useQueryClient();
  const toast = useToast();
  const refresh = () => void qc.invalidateQueries({ queryKey: ['hunts'] });
  const fail = (e: unknown) => toast(e instanceof Error ? e.message : "Couldn't update the hunt");

  const run = useMutation({
    mutationFn: () => api.runHunt(hunt.id),
    onSuccess: () => {
      void Haptics.selectionAsync();
      toast('Running now');
      refresh();
    },
    onError: fail,
  });
  const update = useMutation({
    mutationFn: (patch: Partial<Hunt>) => api.updateHunt(hunt.id, { ...hunt, ...patch }),
    onSuccess: refresh,
    onError: fail,
  });
  const del = useMutation({
    mutationFn: () => api.deleteHunt(hunt.id),
    onSuccess: () => {
      refresh();
      if (router.canGoBack()) router.back();
      toast('Hunt deleted');
    },
    onError: fail,
  });

  return {
    run: () => run.mutate(),
    running: run.isPending || Boolean(hunt.run_requested_at),
    setEnabled: (enabled: boolean) => update.mutate({ enabled }),
    setNotify: (notify: boolean) => update.mutate({ notify }),
    edit: () => router.push({ pathname: '/hunts/form', params: { id: String(hunt.id) } }),
    remove: () =>
      Alert.alert(`Delete "${hunt.name}"?`, 'Its matches go too.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => del.mutate() },
      ]),
  };
}

/** "Running now" / "Checked 5m ago" / "Not run yet". */
export function huntStatus(h: Pick<Hunt, 'run_requested_at' | 'last_run_at'>, timeAgo: (iso: string) => string): string {
  if (h.run_requested_at) return 'Running now';
  return h.last_run_at ? `Checked ${timeAgo(h.last_run_at)}` : 'Not run yet';
}
