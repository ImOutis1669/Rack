import { SHARED_API_VERSION } from '@rack/shared/index';
import { ScrollView, Text } from 'react-native';

export default function Index() {
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 16 }}>
      <Text style={{ fontSize: 17 }} selectable>
        Set-up works. Shared code v{SHARED_API_VERSION}.
      </Text>
    </ScrollView>
  );
}
