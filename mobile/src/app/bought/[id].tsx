// "I bought it" (the web's BoughtSheet): confirm the price paid, then the listing moves from
// Saved into the wardrobe. A toast offers Undo, which puts it back in Saved.
import { defaultPrice, parsePrice } from '@rack/shared/bought';
import type { Listing } from '@rack/shared/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { useToast } from '@/components/Toast';
import { useSession } from '@/lib/auth';
import { setListingState } from '@/lib/listingState';
import { useTheme } from '@/theme/ThemeProvider';
import { tabular } from '@/theme/type';

export default function BoughtSheet() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: item } = useQuery<Listing>({ queryKey: ['listing', Number(id)], enabled: false });
  const api = useSession().api();
  const qc = useQueryClient();
  const toast = useToast();
  const { colors, text } = useTheme();
  const [price, setPrice] = useState(() => defaultPrice(item?.price_gbp));
  const parsed = parsePrice(price);

  const refresh = () => {
    for (const key of ['saved', 'taste', 'feed']) void qc.invalidateQueries({ queryKey: [key] });
  };
  const undo = useMutation({
    mutationFn: (tasteId: number) => api.undoBought(tasteId),
    onSuccess: (r) => {
      if (item) setListingState(item.id, { hidden: false, saved: true });
      refresh();
      toast(r.restored_to_saved ? 'Back in Saved' : "Removed from your wardrobe. The listing is gone, so it couldn't go back to Saved.");
    },
    onError: (e) => toast(e instanceof Error ? e.message : "Couldn't undo"),
  });
  const buy = useMutation({
    mutationFn: () => api.bought(item!.id, parsed!),
    onSuccess: (added) => {
      setListingState(item!.id, { hidden: true, saved: false }); // bought items leave the feed and Saved
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      refresh();
      router.dismissAll(); // this sheet and the listing
      toast({ text: 'Added to your wardrobe', ms: 6000, action: { label: 'Undo', onPress: () => undo.mutate(added.id) } });
    },
  });

  if (!item) return null;
  return (
    <ScrollView
      automaticallyAdjustKeyboardInsets
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.body}>
      <Text style={[text('footnote'), { color: colors.muted }]}>
        {item.title}. Adds it to your wardrobe so it shapes your feed, and stops price alerts.
      </Text>
      <View style={[styles.field, { backgroundColor: colors.surface }]}>
        <Text style={[text('body'), { fontSize: 17, color: colors.muted }]}>£</Text>
        <TextInput
          style={[text('body'), tabular, styles.input, { color: colors.foreground }]}
          value={price}
          onChangeText={setPrice}
          keyboardType="decimal-pad"
          autoFocus
          accessibilityLabel="Price paid in pounds"
          returnKeyType="done"
          onSubmitEditing={() => parsed && buy.mutate()}
        />
      </View>
      {price !== '' && !parsed ? (
        <Text style={[text('footnote'), { color: colors.muted }]}>Enter a price in pounds, like 180 or 180.50</Text>
      ) : null}
      {buy.isError ? <Text style={[text('footnote'), { color: colors.danger }]}>{(buy.error as Error).message}</Text> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !parsed || buy.isPending }}
        disabled={!parsed || buy.isPending}
        onPress={() => buy.mutate()}
        style={({ pressed }) => [
          styles.button,
          { backgroundColor: colors.foreground, opacity: parsed ? 1 : 0.4, transform: [{ scale: pressed ? 0.97 : 1 }] },
        ]}>
        <Text style={[text('headline'), { fontSize: 17, color: colors.background }]}>Add to wardrobe</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 12 },
  field: { flexDirection: 'row', alignItems: 'center', minHeight: 50, borderRadius: 12, paddingHorizontal: 14, gap: 6, borderCurve: 'continuous' },
  input: { flex: 1, fontSize: 17, height: 50 },
  button: { minHeight: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
});
