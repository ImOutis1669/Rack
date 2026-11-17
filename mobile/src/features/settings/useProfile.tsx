import type { Profile } from '@rack/shared/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { Stack } from 'expo-router';
import type { ReactNode } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { useToast } from '@/components/Toast';
import { useSession } from '@/lib/auth';
import { useTheme } from '@/theme/ThemeProvider';

export function useProfile() {
  const api = useSession().api();
  return useQuery({ queryKey: ['profile'], queryFn: api.profile });
}

/** After anything that changes ranking: reload what depends on it. */
export function useAfterTasteSave() {
  const qc = useQueryClient();
  const toast = useToast();
  return () => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    toast('Saved. The feed re-ranks within a minute.');
    for (const key of ['profile', 'designers', 'adjacent', 'feed']) void qc.invalidateQueries({ queryKey: [key] });
  };
}

/** Save the whole profile (each Settings page changes its part). */
export function useSaveProfile() {
  const api = useSession().api();
  const done = useAfterTasteSave();
  return useMutation({ mutationFn: (p: Profile) => api.saveProfile(p), onSuccess: done });
}

/** The page's Save button in the header: enabled once something changed. */
export function SaveButton({ dirty, pending, onPress }: { dirty: boolean; pending: boolean; onPress: () => void }) {
  return (
    <Stack.Toolbar placement="right">
      <Stack.Toolbar.Button variant="done" accessibilityLabel="Save" disabled={!dirty || pending} onPress={onPress}>
        {pending ? 'Saving' : 'Save'}
      </Stack.Toolbar.Button>
    </Stack.Toolbar>
  );
}

/** Renders its page once the profile has loaded. */
export function WithProfile({ children }: { children: (p: Profile) => ReactNode }) {
  const q = useProfile();
  const { colors } = useTheme();
  if (!q.data) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: 60 }}>
        <ActivityIndicator color={colors.muted} />
      </View>
    );
  }
  return <>{children(q.data.profile)}</>;
}
