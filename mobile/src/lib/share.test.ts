import type { BuyLink } from '@rack/shared/types';
import { ActionSheetIOS, Share } from 'react-native';

import { shareListing } from './share';

const link = (source: BuyLink['source'], url: string): BuyLink => ({ source, url, price_gbp: '10', size: null });
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('shareListing', () => {
  let share: jest.SpyInstance;
  beforeEach(() => {
    share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction', activityType: undefined });
  });
  afterEach(() => jest.restoreAllMocks());

  it('opens the share sheet with the marketplace link', async () => {
    shareListing([link('vinted', 'https://www.vinted.co.uk/items/1')], 'Jacket', jest.fn());
    await flush();
    expect(share).toHaveBeenCalledWith({ url: 'https://www.vinted.co.uk/items/1', title: 'Jacket' });
  });

  it('asks which link first when the listing has several', async () => {
    const sheet = jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation((opts, cb) => {
      expect(opts.options).toEqual(['eBay link', 'Grailed link', 'Cancel']);
      cb(1);
    });
    shareListing([link('ebay', 'https://www.ebay.co.uk/itm/1'), link('grailed', 'https://www.grailed.com/listings/2')], 'Coat', jest.fn());
    await flush();
    expect(sheet).toHaveBeenCalled();
    expect(share).toHaveBeenCalledWith({ url: 'https://www.grailed.com/listings/2', title: 'Coat' });
  });

  it('never shares a non-http link', async () => {
    const toast = jest.fn();
    shareListing([link('ebay', 'javascript:alert(1)')], 'x', toast);
    await flush();
    expect(share).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith("Couldn't share the link");
  });
});
