// iOS's own segmented control (SwiftUI Picker, segmented style, from @expo/ui).
import { Host, Picker, Text } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <Host matchContents={{ vertical: true }} style={{ alignSelf: 'stretch' }}>
      <Picker label={label} selection={value} onSelectionChange={(v) => onChange(v as T)} modifiers={[pickerStyle('segmented')]}>
        {options.map(([v, text]) => (
          <Text key={v} modifiers={[tag(v)]}>
            {text}
          </Text>
        ))}
      </Picker>
    </Host>
  );
}
