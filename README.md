# Contracts App (Expo)

Mobile app for contract form completion in the field. Designed for iOS and Android APK builds.

## 1) Install and run locally

```bash
npm install
npm run start
```

## 2) Configure auth

Edit `supabase.js` and set the anon key.

In Supabase Auth URL configuration, add:
- `contractsapp://`
- `contractsapp://login`

## 3) Build for iOS and Android (APK/AAB)

```bash
npm install -g eas-cli
npx eas login
npx eas build -p android --profile preview
npx eas build -p ios --profile production
```

Use `preview` profile for internal Android distribution and test APK flows.

## 4) What is included

- Login / Sign up / Forgot password
- Password recovery deep-link handling
- Contract forms list
- Form completion screen with defect flag for handoff workflow
