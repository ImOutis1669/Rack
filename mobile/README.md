# Rack for iOS

The native iPhone app: Expo SDK 58 (React Native 0.88), TypeScript, `expo-router`. It talks to
the same backend as the web app, over Tailscale at `RACK_PUBLIC_URL`. Plan and steps:
`docs/ios-brief.md`.

## Layout
- `src/app/`: routes (expo-router). Every file there is a screen; `_layout.tsx` files are navigators.
  `_layout.tsx` loads fonts and guards routes with `Stack.Protected` (login vs the app);
  `(tabs)/` is the native tab bar with one stack per tab (`(feed)`, `hunts`, `saved`,
  `wardrobe`); `settings/` is a modal; `login.tsx`.
- `src/lib/`: app-only logic. `session.ts` = the login (bearer token in the Keychain, any 401
  signs out), `auth.tsx` its React provider, `queryClient.ts`.
- `src/theme/`: colour tokens and type roles from `DESIGN.md`; `useTheme()`.
- `src/components/`: `Icon` (Basil, else SF Symbols), `TabStack` (large-title header + Settings
  button), `Grouped` (inset grouped lists).
- `src/private/`: types and the fallback for `@rack/private`. Logic both apps use lives in `../shared/src`
  and is imported as `@rack/shared/<module>` (tsconfig `paths`, Metro `watchFolders` in
  `metro.config.js`, Jest `moduleNameMapper` in `jest.config.js`).
- `assets/private/`: your own licensed font and icon files, git-ignored (see its README).

## Commands
```bash
npm install
npm run private-assets  # your own Neue Montreal + Basil files -> assets/private (optional)
npx expo start          # dev server; open in Expo Go on the iPhone
npm test                # Jest (jest-expo)
npm run typecheck       # tsc
npx expo-doctor         # dependency/config check
npx expo install <pkg>  # add packages: picks the SDK 58 version
```

## Trying it on the iPhone (Expo Go)
0. Put the server in `mobile/.env.local` (git-ignored): `EXPO_PUBLIC_RACK_URL=https://<RACK_PUBLIC_URL>`.
   The login screen can also change it. The API must include `POST /api/auth/token` (iOS step 1).
1. Install **Expo Go** from the App Store (it runs the latest SDK only, which is 58).
2. On the PC: `npx expo start --lan`. If the phone isn't on the same Wi-Fi, use Tailscale: set
   `REACT_NATIVE_PACKAGER_HOSTNAME` to the PC's Tailscale IP (`tailscale ip -4`) before starting.
   Windows Firewall may ask to allow Node on port 8081.
3. Scan the QR code with the iPhone camera, or in Expo Go tap "Enter URL manually" and type
   `exp://<PC Tailscale IP>:<port>` (8081, or the next free port Metro reports).

There is no iOS simulator on Windows. Installable builds come from GitHub Actions
(`.github/workflows/ios-build.yml`, manual run): see `docs/ios-sideload.md` for the secrets
(`npm run pack-secrets` packs your fonts/icons), the encrypted download and Sideloadly.

## Other scripts
```bash
npm run app-icon      # assets/icon.svg -> 1024 px app icon + splash image
npm run pack-secrets  # assets/private -> .ci-secrets/RACK_ASSETS_N.txt for the CI secrets
```
