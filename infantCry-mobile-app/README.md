# InfantCry Mobile — Frontend Starter

A separate mobile frontend project for InfantCry, built with **HTML, CSS, JavaScript and Capacitor** to stay close to the existing web stack. It is intended for Android first, with iOS available when the build environment supports it.

## What is implemented in this stage

- Mobile-friendly login screen with clearly labelled preview authentication.
- Responsive audio input cards based on the supplied web UI.
- Microphone recording with a timer and permission/error messaging.
- WAV file picker and playback preview.
- Actual audio conversion to **mono, 16,000 Hz, PCM 16-bit WAV** for both recordings and chosen WAV files. The code resamples the audio samples; it does not merely rewrite the sample-rate header.
- Selected-audio validation by reading the WAV header.
- Loading, disconnected-model placeholder result, feedback UI preview, and reset/logout flows.
- A separate API-client module with blank endpoint configuration so it can be mapped to the team's real API later.
- Copies of the supplied web files under `reference-web/` for comparison. They are not edited by this mobile project.

## Important status

**This is a frontend-first starter, not a completed AI integration.** Preview login is not real authentication. Analysis displays a labelled “Model not connected” state; it does not invent or simulate a cry category/confidence. Feedback is not saved until the backend contract is provided and configured. The API base URL and routes intentionally remain blank.

## Requirements

- Node.js 22 or later (matches the current Capacitor v8 setup requirements).
- Android Studio with an Android SDK for Android builds.
- USB debugging enabled on a real Android phone for microphone testing. An emulator may not provide usable microphone capture in every environment.

## Setup on Windows

1. Extract this folder to a normal local directory, e.g. `C:\Projects\InfantCry-Mobile`.
2. Open that folder in VS Code.
3. Open **Terminal → New Terminal**.
4. Install the JavaScript packages:

   ```powershell
   npm install
   ```

5. Create the Android native project (do this only once):

   ```powershell
   npm run android:add
   ```

6. Add microphone permissions, synchronize the web files, and open Android Studio:

   ```powershell
   npm run android:run
   ```

7. In Android Studio, allow Gradle sync to finish. Select your device/emulator and press Run.

### iOS (optional, requires macOS + Xcode)

On a Mac, after `npm install`, run:

```bash
npm run ios:add
npm run ios:permissions
npx cap sync ios
npm run ios:open
```

Then select an iPhone Simulator or connected device in Xcode. iOS builds cannot be compiled on Windows.

If you want to preview the front end in a desktop browser first, run:

```powershell
npm start
```

Then open `http://localhost:4173`. Browser microphone capture requires permission and a secure context (localhost is allowed by modern browsers).

## Audio format contract

The output WAV written by `www/audio-utils.js` uses:

- Container: RIFF/WAVE
- Codec: uncompressed PCM (`formatCode = 1`)
- Channels: mono (1)
- Sample rate: 16,000 Hz
- Bit depth: 16-bit signed PCM little-endian

The selected WAV is decoded, downmixed to mono, resampled, and rewritten in this format before it is ready for later analysis. The app's metadata check verifies the output header. Device tests are still required to validate that microphone capture and conversion work correctly on the target phone/WebView.

## API integration later

Edit `www/app-config.js` only after the API teammate confirms the contract:

```js
window.INFANTCRY_CONFIG = Object.freeze({
  previewMode: false,
  apiBaseUrl: "https://YOUR-TEAM-SERVER/api",
  endpoints: {
    login: "auth/login",
    prediction: "CONFIRMED-PREDICTION-PATH",
    feedback: "CONFIRMED-FEEDBACK-PATH"
  },
  audioFieldName: "CONFIRMED-MULTIPART-FIELD"
});
```

The login implementation expects `POST` JSON `{ "username": "...", "password": "..." }` and a successful response containing `access_token`, `role` (`user` or `admin`) and optionally `username`, consistent with the current web frontend's expectations. This is an expectation in frontend code, **not proof that the backend already implements it**.

The prediction endpoint and JSON response field mapping are intentionally left for a later integration step. After the API teammate gives you their route, sample request, sample success response and error schema, update `www/api-client.js` and `www/script.js` together. Do not commit real credentials or tokens into `app-config.js`.

## Phone vs local development URL

Do not use `http://localhost:8000` in the app on a physical phone: `localhost` refers to that phone, not your development PC. Use a server address reachable on the same network for local testing, or a deployed HTTPS endpoint. Do not enable cleartext HTTP in production.

## Tests and validation

Run:

```powershell
npm test
```

The included automated tests validate WAV encoding metadata and the resampler's sample count. These are code-level tests, not a substitute for testing microphone permissions and playback on an actual phone.

## Project layout

```text
InfantCry-Mobile/
├─ www/
│  ├─ index.html          # Mobile screens/structure
│  ├─ style.css           # Mobile-first UI, reuses web palette
│  ├─ script.js           # Screen behavior and audio workflow
│  ├─ audio-utils.js      # WAV conversion, 16 kHz resampling, metadata validation
│  ├─ api-client.js       # Integration boundary; API not connected yet
│  └─ app-config.js       # Preview mode and blank endpoint settings
├─ scripts/
│  ├─ dev-server.mjs
│  └─ ensure-android-permissions.mjs
├─ tests/
│  └─ audio-utils.test.cjs
└─ reference-web/         # Original supplied HTML/CSS/JS, unchanged copies
```

## Current verification status

- Automated audio utility tests: run with `npm test`.
- JavaScript syntax checks: run as part of local validation.
- Browser preview: available through `npm start`.
- Android/iOS build and physical-device microphone test: must be completed on a machine with Android Studio/SDK (and a Mac with Xcode for iOS). This starter is not represented as an already-built APK.
