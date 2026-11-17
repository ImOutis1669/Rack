import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useSession } from '@/lib/auth';
import { loginErrorMessage } from '@/lib/session';
import { useTheme } from '@/theme/ThemeProvider';

// Just the name, username, password and the button: no slogan (DESIGN.md "Copy").
export default function LoginScreen() {
  const session = useSession();
  const { colors, text } = useTheme();
  const [server, setServer] = useState(session.server ?? '');
  const [editServer, setEditServer] = useState(!session.server);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!username.trim() || !password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await session.signIn(server, username, password);
    } catch (e) {
      setError(loginErrorMessage(e));
      setBusy(false);
    }
  };

  const field = [styles.field, text('body'), { fontSize: 17, color: colors.foreground, backgroundColor: colors.surface }];
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView behavior="padding" style={styles.center}>
        <Text accessibilityRole="header" style={[text('largeTitle'), styles.title, { color: colors.foreground }]}>
          Rack
        </Text>
        {editServer ? (
          <TextInput
            style={field}
            value={server}
            onChangeText={setServer}
            placeholder="Server, e.g. rack.tailnet.ts.net"
            placeholderTextColor={colors.subtle}
            accessibilityLabel="Server address"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            textContentType="URL"
          />
        ) : null}
        <TextInput
          style={field}
          value={username}
          onChangeText={setUsername}
          placeholder="Username"
          placeholderTextColor={colors.subtle}
          accessibilityLabel="Username"
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="username"
          autoComplete="username"
          returnKeyType="next"
          autoFocus={!editServer}
        />
        <TextInput
          style={field}
          value={password}
          onChangeText={setPassword}
          placeholder="Password"
          placeholderTextColor={colors.subtle}
          accessibilityLabel="Password"
          secureTextEntry
          textContentType="password"
          autoComplete="current-password"
          returnKeyType="go"
          onSubmitEditing={submit}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !username.trim() || !password || busy }}
          disabled={!username.trim() || !password || busy}
          onPress={submit}
          style={({ pressed }) => [
            styles.button,
            { backgroundColor: colors.foreground, opacity: !username.trim() || !password ? 0.4 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] },
          ]}>
          {busy ? (
            <ActivityIndicator color={colors.background} />
          ) : (
            <Text style={[text('headline'), { fontSize: 17, color: colors.background }]}>Log in</Text>
          )}
        </Pressable>
        {error ? (
          <Text accessibilityLiveRegion="polite" style={[text('footnote'), styles.error, { color: colors.danger }]}>
            {error}
          </Text>
        ) : null}
        {!editServer ? (
          <Pressable accessibilityRole="button" onPress={() => setEditServer(true)} style={styles.serverLink}>
            <Text style={[text('footnote'), { color: colors.muted }]}>{session.server?.replace('https://', '')}</Text>
          </Pressable>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', paddingHorizontal: 24, gap: 12 },
  title: { textAlign: 'center', marginBottom: 16 },
  field: { minHeight: 50, borderRadius: 12, paddingHorizontal: 16, borderCurve: 'continuous' },
  button: { minHeight: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  error: { textAlign: 'center' },
  serverLink: { alignSelf: 'center', padding: 12, minHeight: 44, justifyContent: 'center' },
});
