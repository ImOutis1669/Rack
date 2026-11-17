// Metro config for the iOS app.
// - Also watch ../shared, imported as @rack/shared (tsconfig "paths").
// - @rack/private resolves to the owner's git-ignored assets/private/index.ts when it exists
//   (npm run private-assets), else to src/private/fallback.ts (SF Pro / SF Symbols).
const fs = require('fs');
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.watchFolders = [path.resolve(__dirname, '../shared')];

const privateIndex = path.resolve(__dirname, 'assets/private/index.ts');
const fallback = path.resolve(__dirname, 'src/private/fallback.ts');
const resolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === '@rack/private') {
    return { type: 'sourceFile', filePath: fs.existsSync(privateIndex) ? privateIndex : fallback };
  }
  return (resolveRequest ?? context.resolveRequest)(context, moduleName, platform);
};
module.exports = config;
