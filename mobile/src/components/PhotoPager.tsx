// Listing photos: swipe between them, pinch to zoom in and out, double-tap to zoom in / back out. Zoom is UIScrollView's
// own (maximumZoomScale), so it feels exactly like Photos. The marketplace's full-size photos
// load straight from its CDN, like the web; the first shows the tile's thumbnail meanwhile.
import { Image, type ImageSource } from 'expo-image';
import { useRef, useState } from 'react';
import {
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewInstance,
} from 'react-native';

import { DoubleTap } from '@/lib/doubleTap';
import { useTheme } from '@/theme/ThemeProvider';
import { font, tabular } from '@/theme/type';

function ZoomablePhoto({ uri, width, height, placeholder, label }: { uri: string; width: number; height: number; placeholder?: ImageSource; label: string }) {
  const zoom = useRef<ScrollViewInstance>(null);
  const taps = useRef(new DoubleTap()).current;
  const scale = useRef(1);
  return (
    <ScrollView
      ref={zoom}
      style={{ width, height }}
      contentContainerStyle={{ width, height }}
      maximumZoomScale={4}
      minimumZoomScale={1}
      bouncesZoom
      centerContent
      showsHorizontalScrollIndicator={false}
      showsVerticalScrollIndicator={false}
      scrollEventThrottle={16}
      onScroll={(e) => {
        scale.current = e.nativeEvent.zoomScale ?? 1;
      }}
      onTouchStart={(e) => {
        const n = e.nativeEvent;
        taps.start(n.touches.length, n.pageX, n.pageY, n.timestamp);
      }}
      onTouchEnd={(e) => {
        const n = e.nativeEvent;
        if (!taps.end(n.touches.length, n.pageX, n.pageY, n.timestamp)) return;
        // double-tap: zoomed in -> back to the whole photo; else 2x around the finger (like Photos)
        if (scale.current > 1.01) {
          zoom.current?.scrollResponderZoomTo({ x: 0, y: 0, width, height, animated: true });
        } else {
          const { locationX: x, locationY: y } = n;
          zoom.current?.scrollResponderZoomTo({ x: x - width / 4, y: y - height / 4, width: width / 2, height: height / 2, animated: true });
        }
      }}>
      <Image
        source={{ uri }}
        placeholder={placeholder}
        placeholderContentFit="contain"
        style={{ width, height }}
        contentFit="contain"
        transition={120}
        accessible
        accessibilityLabel={label}
        accessibilityIgnoresInvertColors
      />
    </ScrollView>
  );
}

export function PhotoPager({
  images,
  title,
  width,
  firstPlaceholder,
  loading,
}: {
  images: string[];
  title: string;
  width: number;
  firstPlaceholder?: ImageSource;
  loading: boolean;
}) {
  const { colors, text, customFont } = useTheme();
  const [index, setIndex] = useState(0);
  const height = Math.round(width * 1.25); // 4:5, like the tiles

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / width);
    if (i !== index) setIndex(i);
  };

  return (
    <View style={{ width, height, backgroundColor: colors.fill }}>
      <FlatList
        data={images}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(src, i) => `${i}:${src}`}
        onScroll={onScroll}
        scrollEventThrottle={32}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        renderItem={({ item, index: i }) => (
          <ZoomablePhoto
            uri={item}
            width={width}
            height={height}
            placeholder={i === 0 ? firstPlaceholder : undefined}
            label={`${title}, photo ${i + 1} of ${images.length}`}
          />
        )}
      />
      {images.length > 1 ? (
        <>
          <View style={[styles.counter, { backgroundColor: colors.background + 'CC' }]} pointerEvents="none">
            <Text style={[text('caption'), font('medium', customFont), tabular, { color: colors.foreground }]}>
              {index + 1} / {images.length}
            </Text>
          </View>
          <View style={styles.dots} pointerEvents="none" accessibilityElementsHidden>
            {images.slice(0, 12).map((src, i) => (
              <View
                key={`${i}:${src}`}
                style={[styles.dot, { width: i === index ? 16 : 6, backgroundColor: i === index ? colors.foreground : colors.subtle }]}
              />
            ))}
          </View>
        </>
      ) : null}
      {loading ? (
        <View style={[styles.loading, { backgroundColor: colors.background + 'CC' }]} pointerEvents="none">
          <Text style={[text('caption'), { color: colors.muted }]}>Loading photos</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  counter: { position: 'absolute', top: 12, right: 12, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  loading: { position: 'absolute', top: 12, left: 12, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  dots: { position: 'absolute', bottom: 12, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot: { height: 6, borderRadius: 3 },
});
