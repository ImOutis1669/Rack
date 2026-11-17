import { shareLink, type ShareEnv } from '@rack/shared/share';
import { ActionSheetIOS, Share } from 'react-native';
import { SOURCE_LABEL } from '@rack/shared/format';
import type { BuyLink } from '@rack/shared/types';

/** iOS's share sheet (it has Copy too, so there's no separate clipboard fallback). */
const nativeEnv: ShareEnv = {
  share: async ({ url, title }) => {
    await Share.share({ url, title });
  },
};

/** Share a listing's marketplace link (never Rack's own); several links: pick one first. */
export function shareListing(links: BuyLink[], title: string, toast: (m: string) => void): void {
  const go = async (url: string) => {
    // the shared copy says "Couldn't copy the link": on iOS sharing never copies
    if ((await shareLink(url, title, nativeEnv)) === 'failed') toast("Couldn't share the link");
  };
  if (links.length === 0) return;
  if (links.length === 1) return void go(links[0]!.url);
  const labels = links.map((l) => `${SOURCE_LABEL[l.source] ?? l.source} link`);
  ActionSheetIOS.showActionSheetWithOptions(
    { options: [...labels, 'Cancel'], cancelButtonIndex: labels.length, title: 'Share' },
    (i) => {
      if (i < links.length) void go(links[i]!.url);
    },
  );
}
