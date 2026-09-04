# Changelog

All notable changes to detektIIIF are documented here.

## 4.0.0 - 2026-09-04

### Changed

* Unified the extension builds on Manifest V3 for both Chrome-based browsers and Firefox.
* Replaced the former Manifest V2/V3 script split with target-aware build, development and packaging commands.
* Renamed the former Basket feature to Workspaces throughout the extension UI, code and theme defaults.
* Updated local Mirador integration to `mirador@4.2.4`.
* Updated the UI dependency stack for the new Mirador/annotation path, including React 19 and MUI 7.
* Moved browser-specific manifest settings into theme fragments:
  * `manifest.common.json`
  * `manifest.chrome.json`
  * `manifest.firefox.json`
* Refactored IIIF JSON normalization out of the background script into `src/pages/Background/tools/iiif.js`.
* Refactored generic URL discovery into `src/pages/Background/tools/discovery.js`.
* Moved institution-specific discovery behavior into separate modules under `src/pages/Background/institutions`.
* Removed outdated boilerplate documentation from `docs`.

### Added

* Chrome/Chromium Playwright smoke tests with local fixture pages and fixture IIIF JSON resources.
* Firefox validation command using `web-ext lint`.
* Store packaging commands that produce Chrome and Firefox artifacts from the same active theme.
* IIIF Presentation API v4-style context detection for manifests and collections.
* Workspace sync-storage model with an automatically created `default` workspace.
* Popup workspace selector plus create, rename and delete actions.
* Legacy sync-storage `basket` migration into the `default` workspace.
* Mirador Annotation Editor integration for user-created annotations.
* Workspace-scoped Mirador annotation adapter that persists IIIF AnnotationPage items per canvas in `chrome.storage.sync`.
* More robust label handling for v2 labels and v3/v4 language maps.
* More defensive thumbnail extraction for IIIF Presentation resources.
* Belvedere institution rule:
  * detects `sammlung.belvedere.at/objects/:id/...` pages
  * fetches `/objects/:id/json`
  * extracts `iiifManifest.value`
  * derives Image API `info.json` URLs from Belvedere media dispatcher URLs
* Belvedere fixture smoke test that runs against a realistic local `sammlung.belvedere.at` host mapping.
* Workspace popup test covering add, create, rename and delete behavior.
* Mirador annotation persistence test for workspace-scoped annotations.

### Fixed

* Domain filtering now handles URLs with ports through `new URL(url).hostname`.
* Ignored domains stored in `chrome.storage.local` are now loaded and observed by the background script.
* Image API URL detection now accepts both `http` and `https`.
* Tab script injection now waits for `changeInfo.status === 'complete'`.
* HEAD fallback handling no longer caches known 405/500 fallback cases as rejected before trying GET.
* Stored tab state is normalized defensively when loaded from `chrome.storage.local`.
* Workspace storage operations now surface `chrome.runtime.lastError` failures such as sync-storage quota errors.
* Text-button tooltips in the popup now act as accessible descriptions instead of replacing button names.

### Notes

* The browser extension version and the active theme manifest version are both set to `4.0.0`.
* The repository and default theme folder still use the historical `detektiiif3` path/name where changing it would affect local paths or project history.
* Firefox lint currently reports known bundled third-party warnings, but no extension lint errors.
* Workspace annotations are stored in browser sync storage as requested. This is portable, but annotation-heavy use can hit browser quota limits; a chunked or external annotation backend remains a sensible next architectural step.
* `npm audit` still reports upstream issues in `quill@2.0.3` via `mirador-annotation-editor` and `image-size` via `web-ext` tooling.
