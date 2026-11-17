import { Alert, ScrollView, Text } from 'react-native';

import { Row, Section } from '@/components/Grouped';
import { useSession } from '@/lib/auth';
import { useTheme } from '@/theme/ThemeProvider';

export default function SettingsScreen() {
  const session = useSession();
  const { colors, text } = useTheme();

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
      <Text style={[text('footnote'), { color: colors.muted, marginHorizontal: 32, marginBottom: 16 }]}>
        Profile, designers, hidden sellers, alerts and sources come in iOS step 7.
      </Text>
      <Section title="Account" footer="Log out forgets the password on this iPhone only.">
        <Row label="Server" value={session.server?.replace('https://', '') ?? ''} />
        <Row label="Log out" onPress={() => void session.signOut()} />
        <Row label="Log out everywhere" destructive onPress={logOutEverywhere} />
      </Section>
    </ScrollView>
  );
}
