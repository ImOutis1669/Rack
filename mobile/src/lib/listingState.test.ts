import { clearListingState, getListingState, mergeListingState, setListingState } from './listingState';

describe('listing state shared by tile and sheet', () => {
  afterEach(clearListingState);

  it('merges changes per listing and clears on log out', () => {
    setListingState(1, { saved: true });
    setListingState(1, { vote: -1 });
    setListingState(2, { hidden: true });
    expect(getListingState(1)).toEqual({ saved: true, vote: -1 });
    expect(getListingState(2)).toEqual({ hidden: true });
    clearListingState();
    expect(getListingState(1)).toBeUndefined();
  });

  it('keeps a cleared vote (null) distinct from no change', () => {
    setListingState(3, { vote: null });
    expect(getListingState(3)).toEqual({ vote: null });
  });

  it('gives a new object per change (so React re-renders) and merges with the server values', () => {
    setListingState(4, { saved: true });
    const first = getListingState(4);
    setListingState(4, { vote: 1 });
    expect(getListingState(4)).not.toBe(first);
    expect(mergeListingState({ saved: false, feedback: null }, getListingState(4)!)).toEqual({ saved: true, vote: 1 });
    expect(mergeListingState({ saved: true, feedback: -1 }, {})).toEqual({ saved: true, vote: -1 });
    expect(mergeListingState({ saved: false, feedback: 1 }, { vote: null })).toEqual({ saved: false, vote: null });
  });
});
