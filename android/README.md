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

## Notes / limitations

- The wrapper needs internet (it loads the live site). Login + offline cache work (DOM storage on).
- Links to the companion apps / `mailto:` / `tel:` open in the system browser/handler.
- Blob downloads (the "share schedule as JPEG/PDF" feature) don't save from the WebView — do those
  from Chrome or desktop. Everything else works.
- **Play Store / crew distribution:** needs a release keystore + `assembleFieldRelease`. Ask and we
  can add a signing config (keystore kept out of git).
