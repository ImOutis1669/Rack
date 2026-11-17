// Profile (v2.1): your photo, name and username at the top, then Settings, Sources, security
// and privacy. Your app (the owner's): no Delete account here, friends use the web app.
import { isOwner, memberSince } from '@rack/shared/account';
import type { Account } from '@rack/shared/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActionSheetIOS, Alert, Linking, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { Row, Section } from '@/components/Grouped';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { overallColor } from '@/features/settings/sources';
import { toUpload } from '@/features/wardrobe/upload';
import { useAppLock } from '@/features/lock/AppLock';
import { useSession } from '@/lib/auth';
import { useAccount } from '@/lib/useAccount';
import { useTheme } from '@/theme/ThemeProvider';
import { font } from '@/theme/type';
import { useQuery } from '@tanstack/react-query';

// Compatible mode hands out JPEGs; the picker's square crop is the editor iOS shows.
const PICKER: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images'],
  allowsEditing: true,
  aspect: [1, 1],
  quality: 0.9,
  preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
};

export default function ProfileScreen() {
  const session = useSession();
  const api = session.api();
  const { colors } = useTheme();
  const account = useAccount();
  const lock = useAppLock();
  const health = useQuery({ queryKey: ['health'], queryFn: api.health, refetchInterval: 60_000 });
  const live = health.data?.filter((h) => h.status === 'ok').length;
  const a = account.data;

  const logOutEverywhere = () =>
    Alert.alert('Log out everywhere?', 'Every phone and browser signed in to Rack will need the password again.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log out everywhere',
        style: 'destructive',
        onPress: () =>
          session.logOutEverywhere().catch((e: unknown) =>
            Alert.alert("Couldn't log out everywhere", e instanceof Error ? e.message : undefined),
          ),
      },
    ]);

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: colors.background }}>
      {a ? <Header account={a} /> : <View style={{ height: 200 }} />}
      {a ? <NameRow account={a} /> : null}
      <Section>
        <Row label="Settings" detail="Taste, sizes, budget, alerts" chevron onPress={() => router.push('/profile/settings')} />
        <Row
          label="Sources"
          dot={overallColor(health.data, colors)}
          value={live != null ? `${live} of ${health.data?.length} working` : undefined}
          chevron
          onPress={() => router.push('/profile/settings/sources')}
        />
        {isOwner(a) ? (
          <Row
            label="Friends and invites"
            detail="In the web app"
            onPress={() => session.server && void Linking.openURL(`${session.server}/friends`)}
          />
        ) : null}
      </Section>
      <Section
        title="Security"
        footer="Log out forgets your login on this iPhone only. Log out everywhere ends every session and app login of yours, including this one: use it if a device is lost. Changing your password logs out your other devices.">
        <Row label="Server" value={session.server?.replace('https://', '') ?? ''} />
        <Row label="Change password" chevron onPress={() => router.push('/profile/password')} />
        {lock.available ? (
          <Row
            label={lock.biometryName === 'passcode' ? 'Require passcode' : `Require ${lock.biometryName}`}
            detail="When Rack opens, and after a minute away"
            right={
              <Switch
                style={{ marginLeft: 'auto' }}
                value={lock.enabled}
                accessibilityLabel={`Require ${lock.biometryName}`}
                onValueChange={(v) => void lock.setEnabled(v)}
              />
            }
          />
        ) : null}
        <Row label="Log out" onPress={() => void session.signOut()} />
        <Row label="Log out everywhere" destructive onPress={logOutEverywhere} />
      </Section>
      <Section>
        <Row label="Privacy" chevron onPress={() => router.push('/profile/privacy')} />
      </Section>
    </ScrollView>
  );
}

function Header({ account }: { account: Account }) {
  const session = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const { colors, text, customFont } = useTheme();
  const done = (a: Account) => qc.setQueryData(['account'], a);
  const fail = (e: unknown) => Alert.alert("Couldn't change your photo", e instanceof Error ? e.message : undefined);
  const upload = useMutation({ mutationFn: (asset: ImagePicker.ImagePickerAsset) => session.api().uploadAvatar(toUpload(asset, 0)), onSuccess: done, onError: fail });
  const remove = useMutation({ mutationFn: () => session.api().removeAvatar(), onSuccess: done, onError: fail });
  const busy = upload.isPending || remove.isPending;

  const choose = async (camera: boolean) => {
    if (camera) {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return toast('Camera access is off for Rack in Settings');
    }
    const res = camera ? await ImagePicker.launchCameraAsync(PICKER) : await ImagePicker.launchImageLibraryAsync(PICKER);
    if (!res.canceled && res.assets[0]) upload.mutate(res.assets[0]);
  };
  const edit = () => {
    const options = ['Take photo', 'Choose photo', ...(account.avatar ? ['Remove photo'] : []), 'Cancel'];
    ActionSheetIOS.showActionSheetWithOptions(
      { options, cancelButtonIndex: options.length - 1, destructiveButtonIndex: account.avatar ? 2 : undefined },
      (i) => {
        if (i === 0) void choose(true);
        else if (i === 1) void choose(false);
        else if (i === 2 && account.avatar) remove.mutate();
      },
    );
  };

  return (
    <View style={styles.header}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={account.avatar ? 'Change or remove photo' : 'Add a photo'}
        disabled={busy}
        onPress={edit}
        style={({ pressed }) => ({ opacity: busy ? 0.5 : pressed ? 0.8 : 1 })}>
        <Avatar account={account} size={96} />
        <View style={[styles.badge, { backgroundColor: colors.foreground, borderColor: colors.background }]}>
          <Icon name="camera" size={15} color={colors.background} />
        </View>
      </Pressable>
      <Text style={[text('title'), { color: colors.foreground, marginTop: 10 }]}>{account.display_name}</Text>
      <Text style={[text('footnote'), { color: colors.muted }]}>
        @{account.username}
        {isOwner(account) ? ' · Owner' : ''}
      </Text>
      <Text style={[text('footnote'), font('regular', customFont), { color: colors.muted }]}>{memberSince(account.created_at)}</Text>
    </View>
  );
}

function NameRow({ account }: { account: Account }) {
  const session = useSession();
  const qc = useQueryClient();
  const { colors, text } = useTheme();
  const [name, setName] = useState(account.display_name);
  useEffect(() => setName(account.display_name), [account.display_name]);
  const save = useMutation({
    mutationFn: (n: string) => session.api().updateAccount(n),
    onSuccess: (a) => qc.setQueryData(['account'], a),
    onError: (e) => {
      setName(account.display_name);
      Alert.alert("Couldn't save your name", e instanceof Error ? e.message : undefined);
    },
  });
  const commit = () => {
    const n = name.trim();
    if (n && n !== account.display_name) save.mutate(n);
    else setName(account.display_name);
  };
  return (
    <Section title="Name" footer="Shown on your profile. Your username stays the same.">
      <View style={styles.nameRow}>
        <TextInput
          value={name}
          onChangeText={setName}
          onEndEditing={commit}
          maxLength={60}
          returnKeyType="done"
          textContentType="name"
          accessibilityLabel="Name"
          style={[text('body'), { color: colors.foreground, fontSize: 17, flex: 1 }]}
        />
      </View>
    </Section>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', paddingTop: 12, paddingBottom: 20, gap: 2 },
  badge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameRow: { minHeight: 44, paddingHorizontal: 16, justifyContent: 'center' },
});
