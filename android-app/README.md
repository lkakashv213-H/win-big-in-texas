# Win Big in Texas — Android APK build

This folder turns the LotChance web app into a self-contained Android APK using
[Capacitor](https://capacitorjs.com/). The HTML/CSS/JS is bundled inside the
APK; **the app fetches Texas Lottery data directly from the phone using
Android's native HTTP** (CapacitorHttp plugin), which bypasses CORS — no
Netlify, no proxy, no website needed.

## Prerequisites (one-time)

You need a working Android build toolchain on the machine you build from. The
phone you install the APK on doesn't need any of this.

1. **Node.js 18+** — https://nodejs.org/
2. **Java JDK 17** — https://adoptium.net/ (Temurin works)
3. **Android Studio** (recommended, easiest) — https://developer.android.com/studio
   - Or just the **Android SDK command-line tools** + accept SDK licenses with
     `sdkmanager --licenses` if you prefer no GUI.

After installing Android Studio, set `ANDROID_HOME` (or `ANDROID_SDK_ROOT`) to
the SDK location it installed (Settings → Languages & Frameworks → Android SDK).

## Build the APK

From this `android-app/` folder:

```bash
# 1. Install Capacitor CLI + Android plugin
npm install

# 2. Scaffold the native Android project (one-time)
npx cap add android

# 3. Sync www/ into the Android project (run again whenever you change web files)
npx cap sync android
```

Now build the APK. Two options:

### Option A — Android Studio (graphical)

```bash
npx cap open android
```

This opens the project in Android Studio. Wait for Gradle sync to finish, then:
**Build → Build Bundle(s) / APK(s) → Build APK(s)**. Android Studio will print
the path to the generated APK (typically
`android/app/build/outputs/apk/debug/app-debug.apk`).

### Option B — Command line

```bash
cd android
./gradlew assembleDebug          # macOS / Linux
gradlew.bat assembleDebug        # Windows
```

The APK lands at `android/app/build/outputs/apk/debug/app-debug.apk`.

For a smaller, optimised release build, use `assembleRelease` instead — but a
release APK needs to be signed (Android Studio walks you through key
generation under **Build → Generate Signed Bundle / APK**).

## Install on your phone

1. Plug your phone in via USB.
2. Enable **Developer options** on the phone (Settings → About → tap "Build
   number" 7 times) and turn on **USB debugging**.
3. From this folder:

   ```bash
   adb install -r android/app/build/outputs/apk/debug/app-debug.apk
   ```

   Or just copy the `.apk` file to the phone (Drive, email, USB transfer)
   and tap it — Android will prompt to install. You'll need to allow
   "Install unknown apps" for whichever app you tap from.

The app will appear in your launcher as **Win Big**, with the gold Lone Star
icon. Tapping it opens the full LotChance UI with live Texas Lottery data.

## What's different from the web/Netlify version

- **No service worker, no PWA install prompts** — Android handles app
  lifecycle natively.
- **No Netlify proxy** — `native-fetch.js` patches `window.fetch` so any
  cross-origin call (Texas Lottery CSV, retailer locator, Nominatim
  geocoding) is routed through `CapacitorHttp` (native Android HTTP). This
  bypasses browser CORS entirely.
- **Same UI, same logic** — `app.js`, `data.js`, `styles.css`, `config.js`,
  and `scraper.js` are otherwise unchanged from the `dist/` build.

## Updating the app

Whenever you change anything in `www/`:

```bash
npx cap sync android
# then rebuild the APK
```

Reinstall the APK on the phone (`adb install -r ...` or tap the new file —
Android updates in place if the package ID matches).

## Files in this folder

| Path | Role |
|---|---|
| `www/` | Web app bundle (HTML/JS/CSS/icons) — what the WebView loads |
| `www/native-fetch.js` | Patches `fetch()` to use native HTTP for cross-origin |
| `www/scraper.js` | Texas Lottery scraper (also uses CapacitorHttp directly) |
| `capacitor.config.json` | Capacitor project config (app ID, name, plugins) |
| `package.json` | Capacitor CLI + Android dependencies |
| `android/` | **Generated** by `npx cap add android` — the actual Android Studio project (gradle, MainActivity, AndroidManifest, etc.) |

## Troubleshooting

- **"SDK location not found"** — open `android/local.properties` and set
  `sdk.dir=/path/to/Android/Sdk` (Android Studio creates this automatically
  on first open).
- **Gradle build fails on Java version** — make sure `java -version` reports
  17.x. JDK 21 sometimes works but 17 is the safest with Capacitor 6.
- **App opens but shows no data** — open Chrome on a desktop, go to
  `chrome://inspect`, plug the phone in, and inspect the WebView. The
  `[Scraper]` and `[NativeFetch]` console logs will tell you what's failing.
- **Want a release-signed APK?** — In Android Studio: **Build → Generate
  Signed Bundle / APK → APK → Create new keystore**. Save the keystore
  somewhere safe — you need it to publish updates.
