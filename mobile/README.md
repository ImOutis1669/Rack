# Rack for iOS

The native iPhone app: Expo SDK 58 (React Native 0.88), TypeScript, `expo-router`. It talks to
the same backend as the web app, over Tailscale at `RACK_PUBLIC_URL`. Plan and steps:
`docs/ios-brief.md`.

## Layout
- `src/app/`: routes (expo-router). Every file there is a screen; `_layout.tsx` files are navigators.
- `src/lib/`: app-only logic (storage, auth glue). Logic both apps use lives in `../shared/src`
  and is imported as `@rack/shared/<module>` (tsconfig `paths`, Metro `watchFolders` in
  `metro.config.js`, Jest `moduleNameMapper` in `jest.config.js`).
- `assets/private/`: your own licensed font and icon files, git-ignored (see its README).

## Commands
```bash
npm install
npx expo start          # dev server; open in Expo Go on the iPhone
npm test                # Jest (jest-expo)
npm run typecheck       # tsc
npx expo-doctor         # dependency/config check
npx expo install <pkg>  # add packages: picks the SDK 58 version
```

## Trying it on the iPhone (Expo Go)
1. Install **Expo Go** from the App Store (it runs the latest SDK only, which is 58).
2. On the PC: `npx expo start --lan`. If the phone isn't on the same Wi-Fi, use Tailscale: set
   `REACT_NATIVE_PACKAGER_HOSTNAME` to the PC's Tailscale IP (`tailscale ip -4`) before starting.
   Windows Firewall may ask to allow Node on port 8081.
3. Scan the QR code with the iPhone camera.

There is no iOS simulator on Windows. `npx expo start --web` in a browser is for rough layout
checks only. Installable builds come from GitHub Actions (iOS step 9).
