import type { PrivateAssets } from './types';

/** Used when assets/private/index.ts doesn't exist (CI without the secret, tests, a fresh clone). */
const assets: PrivateAssets = { fonts: {}, basil: {}, barIcons: {} };
export default assets;
