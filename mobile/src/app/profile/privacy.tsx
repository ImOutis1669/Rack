import { ScrollView, StyleSheet, Text } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';

// The same note as the web app's Profile > Privacy.
const PARAGRAPHS = [
  "Rack runs on its owner's own computer, not a company's servers. What you add stays there: your account, taste, designers and sizes, wardrobe and wishlist photos, Saved, votes, hunts, hidden sellers and the devices you turned alerts on for.",
  "Other people using this Rack can't see any of it. The owner runs the server, so they could look at the database.",
  'Photos you upload are re-saved without their location and camera details. Passwords are stored as a one-way hash, never as text.',
  'No ads, no analytics, no tracking. Listings come from eBay, Vinted and Grailed; Rack keeps no eBay seller or buyer details.',
  "Deleting an account removes everything that's in it, at once.",
];

export default function PrivacyScreen() {
  const { colors, text } = useTheme();
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: colors.background }} contentContainerStyle={styles.body}>
      {PARAGRAPHS.map((p) => (
        <Text key={p.slice(0, 20)} style={[text('body'), { color: colors.foreground, fontSize: 17, lineHeight: 24 }]}>
          {p}
        </Text>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({ body: { padding: 20, gap: 14 } });
