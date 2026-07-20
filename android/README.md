# Sitely — Android wrappers

Thin native **WebView wrappers** around the live Sitely web app, so it can be installed as a
real Android app (sideloaded) on devices that won't install the PWA. Each build just loads the
live site, so **app content always tracks the git deploy** — you rarely rebuild the wrapper.

One project, two build flavors:

| Flavor    | App name       | Package                       | Loads                                             |
|-----------|----------------|-------------------------------|---------------------------------------------------|
| `field`   | Sitely Field   | `com.ridgeline.sitely.field`  | `https://ridgeline-workspace.pages.dev/field/`    |
| `desktop` | Sitely         | `com.ridgeline.sitely`        | `https://ridgeline-workspace.pages.dev/`          |

Different package ids, so both can be installed side by side. The start URL is a
`BuildConfig.START_URL` per flavor (see `app/build.gradle`); `MainActivity` just loads it.

## Prebuilt APKs

`dist/SitelyField.apk` and `dist/Sitely.apk` are **debug-signed** builds you can sideload right
now (Android → allow install from this source). Debug signing is fine for your own devices; it is
**not** for the Play Store.

## Rebuild

Needs a JDK (17–21) and the Android SDK (platform 34, build-tools 34). Point the SDK path in
`local.properties` (git-ignored): `sdk.dir=/path/to/android-sdk`. Then:

```
./gradlew assembleFieldDebug      # -> app/build/outputs/apk/field/debug/app-field-debug.apk
./gradlew assembleDesktopDebug    # -> app/build/outputs/apk/desktop/debug/app-desktop-debug.apk
```

Copy those into `dist/` (renamed) if you want to refresh the checked-in binaries.

## Whiteboard home-screen widget

Both flavors ship a resizable **Whiteboard widget** (long-press the home screen → Widgets → Sitely).
It lists the live board notes and lets you **tick checklist items right on the widget**; the **＋**,
the title, and tapping a note row open the app (typing happens in the app — Android widgets can't
accept text input or host a WebView).

How it's wired:
- `MainActivity` bridges the web app's `rl_token` (localStorage) into native `SharedPreferences`
  (`captureToken()` on page-finished and on pause), so the widget can call `/api/board` itself.
- `WhiteboardWidget` (AppWidgetProvider) renders the header + a `ListView` backed by
  `BoardWidgetService` / `BoardFactory` (fetches `GET /api/board`, flattens notes → header rows +
  checklist rows). Ticking an item `PUT`s the flipped board and reloads the list. Refresh button +
  a 30-min periodic update.
- Data/deep-links follow the flavor's `BuildConfig.START_URL` origin.

Untested on a physical device from here (no emulator) — it compiles and installs, but expect to
tweak sizing/behavior after trying it. If the list stays empty, open the app and sign in once so the
token bridges over.

## Notes / limitations

- The wrapper needs internet (it loads the live site). Login + offline cache work (DOM storage on).
- Links to the companion apps / `mailto:` / `tel:` open in the system browser/handler.
- Blob downloads (the "share schedule as JPEG/PDF" feature) don't save from the WebView — do those
  from Chrome or desktop. Everything else works.
- **Play Store / crew distribution:** needs a release keystore + `assembleFieldRelease`. Ask and we
  can add a signing config (keystore kept out of git).
