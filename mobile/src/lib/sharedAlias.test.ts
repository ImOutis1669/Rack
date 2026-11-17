import { SHARED_API_VERSION } from '@rack/shared/index';

// Guards the @rack/shared wiring: tsconfig "paths", Metro watchFolders and Jest's moduleNameMapper.
describe('@rack/shared alias', () => {
  it('resolves the shared package', () => {
    expect(SHARED_API_VERSION).toBe(1);
  });
});
