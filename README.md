![](src/themes/detektiiif3/images/logo_stickerstyle.png)

# detektIIIF 4.0

detektIIIF is a browser extension for Chrome-based browsers and Firefox. It detects IIIF resources on web pages, shows manifests, collections and images in the popup, and lets users collect manifests in workspaces that can be opened or posted to IIIF viewers.

This repository is derived from `chrome-extension-boilerplate-react`, but the old boilerplate documentation has been removed. The current README is the project documentation for the extension itself.

Older versions:

* Version 1: https://github.com/leanderseige/detektiiif
* Version 2: https://github.com/seigedigital/detektiiif2

Current release: `4.0.0`

See `CHANGELOG.md` for release history.

Chrome Web Store listing: https://chromewebstore.google.com/detail/detektiiif3/aaodcobgcadinjipaocibamdfcffpcpp

## What It Detects

detektIIIF currently detects:

* IIIF Presentation API manifests, collections and related resources with v2, v3 and v4-style JSON-LD contexts
* IIIF Image API `info.json` resources
* IIIF URLs found in page HTML
* IIIF Image API URLs inferred from image requests such as `/full/100,/0/default.jpg`
* institution-specific cases where a page or metadata JSON points indirectly to IIIF resources

Detected resources are stored per browser tab in `chrome.storage.local` and displayed in the popup. The popup also shows interoperability hints for CORS, HTTPS and URL/ID equality.

## Architecture

The extension is built as Manifest V3 for both browser targets. The selected theme defines common manifest values, while the build target merges browser-specific manifest fragments.

Main runtime pieces:

* `src/pages/Background/index.js`: service worker/background script. It observes network requests, injects a lightweight DOM scan into tabs, runs URL discovery, fetches candidate JSON and stores detected IIIF resources per tab.
* `src/pages/Background/tools/discovery.js`: generic URL discovery helpers for HTML, page URLs, JSON content types and HEAD/GET fallback decisions.
* `src/pages/Background/tools/iiif.js`: IIIF JSON normalization. It detects API/version/type, normalizes labels and IDs, derives thumbnails, and builds the resource objects saved to tab storage.
* `src/pages/Background/institutions/`: institution-specific discovery rules. Each institution has its own module and is registered in `src/pages/Background/institutions/index.js`.
* `src/pages/Popup/`: React popup UI for manifests, images, collections, workspace actions and links to configured viewers.
* `src/pages/Options/`: React options UI for viewer links and ignored domains.
* `src/pages/MiradorPage/`: local Mirador page that opens manifests from the active workspace and persists user annotations.
* `src/shared/workspaces.js`: shared workspace storage, old basket migration and per-canvas annotation persistence.
* `src/shared/viewerLinks.js`: shared normalization for viewer-link settings, including legacy `tabBasket` settings.
* `src/themes/`: active theme symlink, theme-specific assets, default settings and manifest fragments.
* `utils/`: build, package, manifest merge and development server scripts.

Detection flow:

1. `webRequest` sees JSON network responses and records request metadata.
2. The background script HEAD-checks candidate URLs, then GETs JSON bodies that look relevant.
3. `tools/iiif.js` accepts valid IIIF JSON and builds normalized items.
4. Non-IIIF JSON can still be inspected by institution rules, for example Belvedere object metadata.
5. A tab DOM scan runs after page load and extracts additional IIIF-like URLs from HTML.
6. Institution rules can derive more URLs from the current page URL.
7. Results are saved in `tabStorage` and the action badge/popup update from that state.

## Workspaces And Annotations

Workspaces replace the former basket terminology and behavior. A workspace is a named collection of manifests. The default workspace is named `default` and is created automatically.

Workspace state is stored in `chrome.storage.sync`:

* `workspaces`: workspace definitions, collected manifest items and annotations
* `activeWorkspaceId`: the workspace currently selected in the popup

When an older installation still has the legacy `basket` sync-storage key, it is migrated into the `default` workspace the first time workspace state is loaded.

The popup Workspaces tab provides:

* a workspace dropdown
* create, rename and delete actions
* add/remove/clear behavior equivalent to the old basket
* copy/post as a Presentation API v2 collection
* local Mirador launch for the selected workspace

The default workspace cannot be deleted. Adding a manifest from the Manifests tab always writes to the currently active workspace.

The local Mirador page is bundled through webpack as extension code. It uses `mirador@4.2.4` with `mirador-annotation-editor@1.3.3`; no remote CDN code is loaded at runtime. `src/pages/MiradorPage/workspaceAnnotationAdapter.js` implements the Mirador Annotation Editor adapter API and stores IIIF AnnotationPage items per workspace and canvas in sync storage.

Sync storage keeps small workspace notes portable across browsers signed into the same profile, but it has browser quota limits. Larger annotation-heavy workflows will need a chunked storage model, local storage fallback or external annotation server adapter. Workspace storage operations surface `chrome.runtime.lastError` now, so quota failures are visible instead of being silently ignored.

## Institution Rules

Institution-specific rules live in `src/pages/Background/institutions`.

Available rules:

* `archiveOrg.js`: derives `https://iiif.archive.org/iiif/:id/manifest.json` from `archive.org/details/:id`.
* `belvedere.js`: detects Belvedere object pages, fetches object metadata JSON, extracts `iiifManifest.value`, and derives Image API `info.json` URLs from media dispatcher URLs.
* `eManuscripta.js`: keeps the known HEAD fallback for e-manuscripta servers.
* `eRara.js`: keeps the known HEAD fallback for e-rara.
* `europeana.js`: derives the SMK IIIF manifest URL from the known Europeana/SMK item URL pattern.
* `nationalMuseumSE.js`: derives `manifest.json` URLs from Nationalmuseum Sweden IIIF hosting URLs.

To add a new institution:

1. Create `src/pages/Background/institutions/myInstitution.js`.
2. Export an object with one or more of these optional methods:

```js
export default {
  name: 'My Institution',
  getUrlsFromPageUrl(pageUrl) {
    return []
  },
  getUrlsFromJSON(body, sourceUrl) {
    return []
  },
  shouldFetchBodyAfterHead(url, status) {
    return false
  }
}
```

3. Register it in `src/pages/Background/institutions/index.js`.
4. Add a fixture page/resource in `tests/fixtures`.
5. Add a case to `tests/chrome-extension.spec.js`.

Rules should return candidate URLs only. Fetching, caching, CORS handling and IIIF validation stay in the background/discovery pipeline.

## Belvedere Rule

Belvedere object pages such as:

```text
https://sammlung.belvedere.at/objects/5686/...
```

trigger these candidate URLs:

```text
https://sammlung.belvedere.at/objects/5686/json
https://sammlung.belvedere.at/apis/iiif/presentation/v2/1-objects-5686/manifest
```

When the metadata JSON is fetched, the rule also extracts:

* the manifest URL from `object[].iiifManifest.value`
* image service IDs from `object[].media.value` and `object[].primaryMedia.value`
* Image API info URLs like `https://sammlung.belvedere.at/apis/iiif/image/v2/18966/info.json`

The Belvedere smoke test uses a local fixture page without direct IIIF links. This proves the detection works through the institution rule rather than the generic HTML URL scanner.

## Setup

Install dependencies:

```bash
npm install
```

Install Playwright's Chromium once for the Chrome extension tests:

```bash
npx playwright install chromium
```

## Configure Theme

Choose the active theme:

```bash
cd src/themes
./settheme.sh detektIIIF3
```

Manifest version selection is no longer part of theme selection. Both browser targets are built as MV3.

Each theme contains:

* `manifest.common.json`
* `manifest.chrome.json`
* `manifest.firefox.json`
* `Defaults.js`
* `Theme.js`
* `Styles.css`
* images and other theme assets

`src/themes/active` and `src/themes/manifest.json` are symlinks managed by `settheme.sh`.

## Development

Start a development build server:

```bash
npm run start:chrome
npm run start:firefox
```

The default `npm run start` target is Chrome.

Load in Chrome or Chromium:

* open `chrome://extensions`
* enable Developer mode
* click `Load unpacked`
* select `build/chrome`

Load in Firefox:

* open `about:debugging`
* click `This Firefox`
* click `Load Temporary Add-on`
* select `build/firefox/manifest.json`

## Build And Package

Build both browser targets:

```bash
npm run build
```

Build one target:

```bash
npm run build:chrome
npm run build:firefox
```

Package store artifacts:

```bash
npm run package
npm run package:chrome
npm run package:firefox
```

Artifacts are written to `dist`. Firefox packaging also creates a source tarball for AMO review.

The legacy wrappers still exist:

```bash
./pack4cws.sh [output-folder]
./pack4amo.sh [output-folder]
```

## Tests

Run the Chrome/Chromium smoke tests:

```bash
npm run test:chrome
```

This command builds `build/chrome` and runs Playwright against a temporary local fixture server.

The fixture suite covers:

* Presentation API v2 manifests
* Presentation API v3 manifests
* Presentation API v4-style manifests
* Presentation API v2 collections
* Presentation API v4-style collections
* Image API resources inferred from image URLs
* Belvedere object pages via the institution rule
* workspace create/rename/delete behavior and adding manifests to the active workspace
* local Mirador startup with workspace-scoped annotation persistence

Fixture files live in `tests/fixtures`. They can use the `{{origin}}` placeholder, which the test server replaces with the current local origin.

The Belvedere test maps `sammlung.belvedere.at` to the local fixture server through Playwright's `--host-resolver-rules`, so the extension sees a realistic Belvedere URL without depending on the live site.

Run Firefox validation:

```bash
npm run lint:firefox
```

This builds `build/firefox` and runs `web-ext lint`. Current known warnings come from bundled third-party code such as Mirador/MUI and are tracked separately from extension logic errors.

Current `npm audit` notes:

* production dependency warning: `mirador-annotation-editor` currently pulls `react-quill-new -> quill@2.0.3`, which has a low-severity XSS advisory in Quill's HTML export path
* development-tooling warning: `web-ext -> addons-linter -> image-size` reports high-severity parser DoS advisories; npm only offers a breaking `web-ext` downgrade via `npm audit fix --force`

Both should be revisited when upstream packages publish compatible fixes.

Open Firefox manually with the built extension:

```bash
npm run run:firefox
```

Useful focused checks:

```bash
node -c src/pages/Background/index.js
node -c src/pages/Background/tools/iiif.js
node -c src/pages/Background/tools/discovery.js
```

## Versioning

There are two version numbers:

* extension package version in `package.json`, currently `4.0.0`
* theme/manifest version in `src/themes/<theme>/manifest.common.json`, currently `4.0.0`

Keep both intentional before packaging a release.
