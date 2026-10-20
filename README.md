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
* `src/shared/workspaces.js`: shared workspace API, old basket migration and per-canvas annotation persistence.
* `src/shared/storage/`: workspace backend settings and GitHub repository persistence.
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

Workspace storage is configurable from the options page:

* `Browser Sync`: default storage backend using browser sync storage
* `GitHub Storage`: stores workspace data in dedicated GitHub repositories through a personal access token

The same options section also contains an annotation display name. Browser Sync annotations use that name as creator/editor metadata. GitHub-backed annotations prefer the authenticated GitHub login from the configured PAT and use the display name as a fallback.

The Browser Sync backend stores workspace state in `chrome.storage.sync` with a chunked layout:

* `workspaceIndex`: workspace metadata, update timestamps and chunk counts
* `workspace:<workspace-id>:items:<index>`: collected manifest items split into quota-safe chunks
* `workspace:<workspace-id>:annotations:<index>`: per-canvas annotation data split into quota-safe chunks
* `activeWorkspaceId`: the workspace currently selected in the popup

When an older installation still has the legacy `workspaces` or `basket` sync-storage keys, they are migrated into the chunked model the first time workspace state is loaded. Legacy basket items are merged into the `default` workspace.

The GitHub backend is configured with a fine-grained personal access token. detektIIIF treats one GitHub repository as one workspace, so GitHub's own repository permissions can be used for collaboration. GitHub workspace repositories are selected, created, initialized, renamed and deleted from the popup Workspaces tab. detektIIIF keeps the dropdown list in a private `detektiiif-workspace-registry` repository instead of scanning the GitHub account. The registry stores minimal links to workspace repositories; each workspace repository is still recognized by the `workspace.json` magic file at its repository root. Existing empty repositories can be initialized from the popup create action by entering their repository name. Data is stored at the repository root:

```text
workspace.json
revisions/<revision-id>/items/0001.json
revisions/<revision-id>/items/0002.json
revisions/<revision-id>/annotations/index/0001.json
revisions/<revision-id>/annotations/<canvas-id-hash>/0001.json
revisions/<revision-id>/annotations/<canvas-id-hash>/0002.json
```

`workspace.json` is the atomic pointer to one complete workspace revision. Changed data files are uploaded below a unique revision directory first; only after every upload succeeds is `workspace.json` replaced using GitHub's expected-file SHA. Unchanged files may be reused from an older revision. Annotation data is stored as Web Annotation `AnnotationPage` JSON and split into additional page files when needed. Files target about 512 KiB and are rejected before they exceed the extension's 900 KiB safety limit.

GitHub workspaces receive a stable ID below `https://detektiiif.net/workspaces/`. AnnotationPage and annotation IDs are derived from that ID and therefore survive repository renames. Every stored AnnotationPage also has a `seeAlso` link to its concrete `raw.githubusercontent.com` source, and `workspace.json` records the current GitHub repository URL. Version 1 and 2 repositories remain readable and are rewritten in the revision-based version 3 format on their next mutation.

Before every mutation, detektIIIF reloads the latest workspace state and applies only the requested item or annotation change to that state. Annotation files use a three-way merge by annotation ID, so unrelated additions from other collaborators are retained. If `workspace.json` changed after it was read, GitHub rejects the stale SHA and detektIIIF reloads, reapplies and retries the mutation. Repeated conflicting edits to the same annotation still resolve to the last successfully published edit.

Setup details are documented in `docs/github-storage.md`.

The popup Workspaces tab provides:

* a workspace dropdown
* create, rename and delete actions
* opening shared GitHub workspace links, including public repositories without a PAT
* a GitHub sharing dialog for copying the repository link, changing visibility, and managing Viewer/Editor collaborators and pending invitations
* add/remove behavior for manifests
* `Clear Workspace`, which removes all collected manifests and all workspace annotations from the selected storage backend
* copy/post as a Presentation API v2 collection
* local Mirador launch for the selected workspace

The default Browser Sync workspace cannot be deleted. Adding a manifest from the Manifests tab always writes to the currently active workspace. With GitHub Storage, the workspace dropdown lists registered repositories whose `workspace.json` is marked as a detektIIIF workspace; create initializes an existing empty repository or creates a new one, and rename/delete operate on the GitHub repository and registry entry. Public shared repositories can be opened without credentials as read-only workspaces. For private repositories, every participant uses their own PAT and GitHub permission; Viewer access disables workspace changes and Mirador annotation editing, while Editor access permits both. GitHub currently requires outside/repository collaborators to use a classic PAT for private repositories, and private personal-account repositories do not offer a separate read-only collaborator role; these GitHub constraints are detailed in `docs/github-storage.md`.

The local Mirador page is bundled through webpack as extension code. It uses `mirador@4.2.4` with `mirador-annotation-editor@1.3.3`; no remote CDN code is loaded at runtime. `src/pages/MiradorPage/workspaceAnnotationAdapter.js` implements the Mirador Annotation Editor adapter API and stores IIIF AnnotationPage items per workspace and canvas through the configured workspace backend. New and updated annotations are enriched with creator/editor metadata. Mirador annotation writes are debounced to avoid storage write-rate pressure during rapid editor updates. Pending data is journaled temporarily in local extension storage until the backend write succeeds, so closing the page during the debounce interval does not discard the latest edit. Failed writes are retried three times with bounded backoff; Mirador shows progress and leaves a manual Retry action visible after the final failure.

GitHub-backed Mirador pages load the current repository state when they are opened or when the selected workspace changes. They do not poll GitHub automatically; reopen or reselect the workspace to load changes made by collaborators.

The chunked sync-storage model avoids Chrome's per-item quota for normal annotation payloads and keeps workspace notes portable across browsers signed into the same profile. Browser Sync mutations in extension pages use a browser-wide Web Lock, so concurrent popup and Mirador writes in the same browser profile are serialized. Changes independently synchronized from another device remain subject to the browser's sync conflict behavior. Browser sync storage still has total and sustained-write quotas, so very large annotation-heavy workflows may eventually need a local-storage fallback or external annotation server adapter. Workspace storage operations surface `chrome.runtime.lastError`, so quota failures are visible instead of being silently ignored.

New annotations use stable HTTPS IDs below `https://detektiiif.net/workspaces/...`. The namespace is reserved for a future detektIIIF or institution-specific resolver. GitHub repositories additionally expose the current raw JSON source through AnnotationPage `seeAlso` links, so public repository data remains directly fetchable without making identity depend on a mutable repository name.

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
* sync-storage chunking for large workspace annotations
* segmented GitHub storage and stable annotation IDs across repository renames
* atomic GitHub revision publishing, SHA-conflict merging and failed-upload isolation
* concurrent Browser Sync mutations from separate extension pages
* debounced Mirador annotation writes to stay below sync-storage write-rate limits
* failed annotation-write retries and the manual recovery action
* ignored-domain editing, blocked detection and stale-state cleanup on excluded hosts
* workspace storage backend configuration in the options page
* same-tab navigation cleanup, stale-render suppression, collaborative GitHub annotation merging and repository cache isolation

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
