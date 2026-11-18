// Add to the wardrobe or wishlist (the web's AddSheet): photos from the camera or the library,
// a link to an image or listing, or a short description.
import type { TasteKind } from '@rack/shared/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Field, Input, PrimaryButton } from '@/components/Form';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { pickedFile } from '@/lib/uploadFile';
import { useSession } from '@/lib/auth';
import { useTheme } from '@/theme/ThemeProvider';
import { font } from '@/theme/type';

const MAX_PHOTOS = 20;
const PICKER: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images'],
  quality: 0.9,
  // HEIC becomes JPEG, which the server reads; it strips EXIF and re-encodes anyway
  preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
};

export default function AddSheet() {
  const { kind = 'wardrobe' } = useLocalSearchParams<{ kind?: TasteKind }>();
  const api = useSession().api();
  const qc = useQueryClient();
  const toast = useToast();
  const { colors, text, customFont } = useTheme();
  const [photos, setPhotos] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [desc, setDesc] = useState('');

  const done = (msg: string) => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    void qc.invalidateQueries({ queryKey: ['taste'] });
    void qc.invalidateQueries({ queryKey: ['profile'] });
    router.back();
    toast(msg);
  };
  const upload = useMutation({
    mutationFn: () => api.uploadTaste(kind, photos.map((p) => pickedFile(p.uri)), name.trim() || undefined),
    onSuccess: (added) => done(`Added ${added.length} photo${added.length === 1 ? '' : 's'}`),
  });
  const byUrl = useMutation({ mutationFn: () => api.addTasteUrl(kind, url.trim(), name.trim() || undefined), onSuccess: () => done('Added') });
  const byText = useMutation({ mutationFn: () => api.addTasteText(kind, desc.trim()), onSuccess: () => done('Added') });
  const err = upload.error ?? byUrl.error ?? byText.error;

  const denied = (what: string) =>
    Alert.alert(`Rack can't use your ${what}`, `Allow it in Settings to add photos.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Open Settings', onPress: () => void Linking.openSettings() },
    ]);
  const pickLibrary = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ ...PICKER, allowsMultipleSelection: true, selectionLimit: MAX_PHOTOS });
    if (!res.canceled) setPhotos(res.assets.slice(0, MAX_PHOTOS));
  };
  const takePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return denied('camera');
    const res = await ImagePicker.launchCameraAsync(PICKER);
    if (!res.canceled) setPhotos((p) => [...p, ...res.assets].slice(0, MAX_PHOTOS));
  };

  const title = kind === 'wardrobe' ? 'Add to wardrobe' : 'Add to wishlist';
  return (
    <ScrollView automaticallyAdjustKeyboardInsets contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: colors.background }} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title }} />
      <View style={styles.pickRow}>
        <PickButton icon="add-photo" label="Choose photos" onPress={() => void pickLibrary()} />
        <PickButton icon="camera" label="Take photo" onPress={() => void takePhoto()} />
      </View>
      {photos.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {photos.map((p, i) => (
            <Pressable
              key={`${p.uri}-${i}`}
              accessibilityRole="button"
              accessibilityLabel={`Remove photo ${i + 1}`}
              onPress={() => setPhotos((all) => all.filter((_, j) => j !== i))}>
              <Image source={{ uri: p.uri }} style={[styles.preview, { backgroundColor: colors.fill }]} contentFit="cover" />
            </Pressable>
          ))}
        </ScrollView>
      ) : (
        <Text style={[text('caption'), { color: colors.muted }]}>Up to {MAX_PHOTOS} at once. Tap a photo to remove it.</Text>
      )}
      <Input value={name} onChangeText={setName} placeholder="Name (optional), e.g. black Margiela derbies" />
      <PrimaryButton
        label={upload.isPending ? 'Uploading' : photos.length ? `Add ${photos.length} photo${photos.length === 1 ? '' : 's'}` : 'Add photos'}
        disabled={!photos.length || upload.isPending}
        onPress={() => upload.mutate()}
      />

      <View style={styles.or}>
        <View style={[styles.line, { backgroundColor: colors.border }]} />
        <Text style={[text('caption'), { color: colors.muted }]}>or</Text>
        <View style={[styles.line, { backgroundColor: colors.border }]} />
      </View>

      <Field label="Image or listing link">
        <View style={styles.inline}>
          <Input value={url} onChangeText={setUrl} placeholder="https://" keyboardType="url" autoCapitalize="none" autoCorrect={false} style={{ flex: 1 }} />
          <SmallButton label={byUrl.isPending ? 'Adding' : 'Add'} disabled={!url.trim() || byUrl.isPending} onPress={() => byUrl.mutate()} />
        </View>
      </Field>
      <Field label="Describe it">
        <View style={styles.inline}>
          <Input value={desc} onChangeText={setDesc} placeholder="Long black wool overcoat" style={{ flex: 1 }} />
          <SmallButton label="Add" disabled={!desc.trim() || byText.isPending} onPress={() => byText.mutate()} />
        </View>
      </Field>
      {err ? <Text style={[text('footnote'), { color: colors.danger }]}>{(err as Error).message}</Text> : null}
    </ScrollView>
  );

  function PickButton({ icon, label, onPress }: { icon: 'add-photo' | 'camera'; label: string; onPress: () => void }) {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }) => [styles.pick, { backgroundColor: colors.surface, borderColor: colors.border, transform: [{ scale: pressed ? 0.97 : 1 }] }]}>
        <Icon name={icon} size={26} color={colors.muted} />
        <Text style={[text('footnote'), font('medium', customFont), { color: colors.foreground }]}>{label}</Text>
      </Pressable>
    );
  }
  function SmallButton({ label, disabled, onPress }: { label: string; disabled: boolean; onPress: () => void }) {
    return (
      <Pressable
        accessibilityRole="button"
        disabled={disabled}
        onPress={onPress}
        style={[styles.small, { backgroundColor: colors.fill, opacity: disabled ? 0.4 : 1 }]}>
        <Text style={[text('footnote'), font('medium', customFont), { color: colors.foreground }]}>{label}</Text>
      </Pressable>
    );
  }
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 16, paddingBottom: 40 },
  pickRow: { flexDirection: 'row', gap: 12 },
  pick: { flex: 1, alignItems: 'center', gap: 6, paddingVertical: 22, borderRadius: 16, borderWidth: 1, borderStyle: 'dashed', borderCurve: 'continuous' },
  preview: { width: 72, height: 90, borderRadius: 8 },
  or: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  line: { flex: 1, height: StyleSheet.hairlineWidth },
  inline: { flexDirection: 'row', gap: 8 },
  small: { minHeight: 44, paddingHorizontal: 16, borderRadius: 22, justifyContent: 'center' },
});
