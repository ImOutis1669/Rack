// A wardrobe / wishlist item (the web's TasteItemSheet): the photo and only the fields that have
// values; the pencil switches to an edit form with Save / Cancel and Delete (or Move back to
// Saved for things you bought). Wardrobe items also show the estimate and the trend.
import { CATEGORIES, type TasteItem, type TasteKind } from '@rack/shared/types';
import { safeHref } from '@rack/shared/safe';
import {
  CATEGORY_LABEL,
  detailRows,
  displayName,
  draftErrors,
  draftFrom,
  itemName,
  patchFrom,
  photoState,
  sourceLink,
  tileValue,
  type Draft,
} from '@rack/shared/tasteItem';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActionSheetIOS, Linking, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { Chip } from '@/components/Chip';
import { Field, Input, MoneyInput, PrimaryButton } from '@/components/Form';
import { Row, Section } from '@/components/Grouped';
import { useToast } from '@/components/Toast';
import { EstimateSection } from '@/features/wardrobe/EstimateSection';
import { useSession } from '@/lib/auth';
import { apiImage } from '@/lib/images';
import { useTheme } from '@/theme/ThemeProvider';
import { font, tabular } from '@/theme/type';

export default function TasteItemScreen() {
  const { id, kind = 'wardrobe' } = useLocalSearchParams<{ id: string; kind?: TasteKind }>();
  const api = useSession().api();
  const items = useQuery({ queryKey: ['taste', kind], queryFn: () => api.taste(kind) });
  const item = items.data?.find((i) => i.id === Number(id));
  const { colors } = useTheme();
  if (!item) return <View style={{ flex: 1, backgroundColor: colors.background }} />;
  return <ItemSheet item={item} />;
}

/** "2026-11-16" <-> a Date at local midnight (no timezone shift). */
const toDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
};
const toIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function ItemSheet({ item }: { item: TasteItem }) {
  const api = useSession().api();
  const session = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const { colors, text, customFont } = useTheme();
  const { width } = useWindowDimensions();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => draftFrom(item));
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const errors = draftErrors(draft);
  const wardrobe = item.kind === 'wardrobe';

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['taste'] });
    void qc.invalidateQueries({ queryKey: ['saved'] });
  };
  const save = useMutation({
    mutationFn: () => api.patchTaste(item.id, patchFrom(draft, item.kind)),
    onSuccess: () => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setEditing(false);
      refresh();
    },
  });
  const remove = useMutation({
    mutationFn: () => api.deleteTaste(item.id),
    onSuccess: () => {
      refresh();
      router.back();
      toast('Deleted');
    },
    onError: (e) => toast(e instanceof Error ? e.message : "Couldn't delete"),
  });
  const backToSaved = useMutation({
    mutationFn: () => api.undoBought(item.id),
    onSuccess: (r) => {
      refresh();
      router.back();
      toast(r.restored_to_saved ? 'Back in Saved' : "Removed. The listing is gone, so it couldn't go back to Saved.");
    },
    onError: (e) => toast(e instanceof Error ? e.message : "Couldn't move it"),
  });
  const confirmDelete = () => {
    const bought = Boolean(item.purchased_at);
    const options = bought ? ['Delete', 'Move back to Saved', 'Cancel'] : ['Delete', 'Cancel'];
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: 'Delete this item?',
        message: bought
          ? 'It leaves your wardrobe. You can also put it back in Saved instead.'
          : "It leaves your wardrobe and stops shaping your feed. This can't be undone.",
        options,
        destructiveButtonIndex: 0,
        cancelButtonIndex: options.length - 1,
      },
      (i) => {
        if (i === 0) remove.mutate();
        if (bought && i === 1) backToSaved.mutate();
      },
    );
  };

  const title = editing ? 'Edit' : (item.brand ?? (wardrobe ? 'Wardrobe' : 'Wishlist'));
  const toolbar = (
    <>
      <Stack.Screen options={{ title }} />
      <Stack.Toolbar placement="left">
        {editing ? (
          <Stack.Toolbar.Button accessibilityLabel="Cancel" onPress={() => setEditing(false)}>
            Cancel
          </Stack.Toolbar.Button>
        ) : (
          <Stack.Toolbar.Button icon="xmark" accessibilityLabel="Close" onPress={() => router.back()} />
        )}
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        {editing ? (
          <Stack.Toolbar.Button
            variant="done"
            accessibilityLabel="Save"
            disabled={Object.keys(errors).length > 0 || save.isPending}
            onPress={() => save.mutate()}>
            Save
          </Stack.Toolbar.Button>
        ) : (
          <Stack.Toolbar.Button
            icon="pencil"
            accessibilityLabel="Edit"
            onPress={() => {
              setDraft(draftFrom(item));
              setEditing(true);
            }}
          />
        )}
      </Stack.Toolbar>
    </>
  );

  if (editing) {
    const auto = item.effective_category && item.effective_category !== 'any' ? `Auto (${CATEGORY_LABEL[item.effective_category]})` : 'Not set';
    return (
      <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: colors.background }} contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
        {toolbar}
        <Field label="Brand">
          <Input value={draft.brand} onChangeText={(v) => set('brand', v)} placeholder={item.estimate_brand ?? 'e.g. Rick Owens'} autoCorrect={false} />
        </Field>
        <Field label="Name">
          <Input value={draft.name} onChangeText={(v) => set('name', v)} placeholder="e.g. black leather jacket" />
        </Field>
        <Field label="Size">
          <Input value={draft.size} onChangeText={(v) => set('size', v)} placeholder="e.g. M, UK 9" autoCorrect={false} />
        </Field>
        <Field label="Category">
          <View style={styles.chips}>
            <Chip label={auto} selected={draft.category === ''} onPress={() => set('category', '')} />
            {CATEGORIES.map((c) => (
              <Chip key={c} label={CATEGORY_LABEL[c]} selected={draft.category === c} onPress={() => set('category', c)} />
            ))}
          </View>
        </Field>
        {wardrobe ? (
          <>
            <Field label="Price paid" error={errors.paid}>
              <MoneyInput label="Price paid" value={draft.paid} onChange={(v) => set('paid', v)} />
            </Field>
            <Field
              label="Your value"
              error={errors.worth}
              hint={item.estimate_gbp != null ? 'Leave empty to use the estimate.' : 'Leave empty to count it at what you paid.'}>
              <MoneyInput label="Your value" value={draft.worth} onChange={(v) => set('worth', v)} />
            </Field>
            <Field label="Date of purchase" error={errors.date}>
              <View style={styles.dateRow}>
                {draft.date ? (
                  <DateTimePicker
                    value={toDate(draft.date)}
                    mode="date"
                    display="compact"
                    maximumDate={new Date()}
                    minimumDate={new Date(1950, 0, 1)}
                    onChange={(_, d) => d && set('date', toIso(d))}
                    accessibilityLabel="Date of purchase"
                  />
                ) : (
                  <Chip label="Add date" onPress={() => set('date', toIso(new Date()))} />
                )}
                {draft.date ? <Chip label="Clear" onPress={() => set('date', '')} /> : null}
              </View>
            </Field>
          </>
        ) : null}
        <Field label="Note">
          <Input value={draft.note} onChangeText={(v) => set('note', v)} multiline style={{ height: 96, paddingTop: 12, textAlignVertical: 'top' }} />
        </Field>
        {save.isError ? <Text style={[text('footnote'), { color: colors.danger }]}>{(save.error as Error).message}</Text> : null}
        <View style={{ paddingTop: 12 }}>
          <PrimaryButton label="Delete item" tone="danger" disabled={remove.isPending || backToSaved.isPending} onPress={confirmDelete} />
        </View>
      </ScrollView>
    );
  }

  const value = tileValue(item);
  const rows = detailRows(item);
  const link = sourceLink(item);
  const state = photoState(item);
  const name = itemName(item);
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: colors.background }} contentContainerStyle={{ paddingBottom: 40 }}>
      {toolbar}
      {item.image ? (
        <Image
          source={apiImage(session, item.image)}
          style={{ width, height: width * 1.25, backgroundColor: colors.fill }}
          contentFit="cover"
          accessibilityLabel={displayName(item)}
        />
      ) : (
        <View style={[styles.textPhoto, { width, height: width * 0.75, backgroundColor: colors.fill }]}>
          <Text style={[text('title'), { color: colors.foreground, textAlign: 'center' }]}>“{displayName(item)}”</Text>
        </View>
      )}
      <View style={styles.body}>
        <View style={{ gap: 4 }}>
          {item.brand ? (
            <Text style={[text('caption'), font('medium', customFont), { color: colors.muted, letterSpacing: 0.4 }]}>{item.brand.toUpperCase()}</Text>
          ) : null}
          <Text accessibilityRole="header" style={[text('title'), { color: name ? colors.foreground : colors.muted }]}>
            {name ?? 'No name yet'}
          </Text>
          {value ? <Text style={[text('title'), font('bold', customFont), tabular, { fontSize: 26, color: colors.foreground }]}>{value}</Text> : null}
          {state ? <Text style={[text('footnote'), { color: colors.muted }]}>{state}</Text> : null}
        </View>
        {rows.length > 0 ? (
          <View style={{ marginHorizontal: -16 }}>
            <Section>
              {rows.map((r) => (
                <Row key={r.label} label={r.label} value={r.value} />
              ))}
            </Section>
          </View>
        ) : null}
        {link && safeHref(link.href) ? (
          <PrimaryButton label={link.label} tone="secondary" onPress={() => void Linking.openURL(safeHref(link.href)!)} />
        ) : null}
        {item.note ? (
          <View style={{ gap: 4 }}>
            <Text style={[text('footnote'), font('medium', customFont), { color: colors.muted }]}>Note</Text>
            <Text selectable style={[text('body'), { color: colors.foreground }]}>
              {item.note}
            </Text>
          </View>
        ) : null}
        <EstimateSection item={item} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  form: { padding: 16, gap: 18, paddingBottom: 40 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  textPhoto: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  body: { padding: 16, gap: 24 },
});
