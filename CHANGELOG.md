# Changelog

All notable changes to detektIIIF are documented here.

## 4.0.0 - 2026-09-04

### Changed

* Unified the extension builds on Manifest V3 for both Chrome-based browsers and Firefox.
* Replaced the former Manifest V2/V3 script split with target-aware build, development and packaging commands.
* Renamed the former Basket feature to Workspaces throughout the extension UI, code and theme defaults.
* Updated local Mirador integration to `mirador@4.2.4`.
* Updated the UI dependency stack for the new Mirador/annotation path, including React 19 and MUI 7.
* Changed workspace persistence to a chunked sync-storage layout with `workspaceIndex` metadata and separate item/annotation chunks per workspace.
* Debounced Mirador annotation writes so rapid editor updates are persisted in batches instead of one sync-storage write per update.
* Added configurable workspace storage backends with Browser Sync as default and GitHub Storage via personal access token.
* Added GitHub repository storage. One repository is one workspace and stores a versioned `workspace.json` plus segmented item, annotation-index and Web Annotation `AnnotationPage` files.
* Changed GitHub persistence to immutable revision directories with `workspace.json` as the atomic publication pointer; version 1 and 2 repositories remain readable and migrate on write.
* Simplified GitHub storage settings to backend selection plus personal access token; GitHub URLs, default branch, repository selection and storage paths are derived or handled by the extension.
* Changed new user annotation IDs from an internal `detektiiif://` URI to globally unique HTTPS IDs.
* Changed GitHub-backed AnnotationPage and annotation IDs to stable `detektiiif.net` workspace URIs that survive repository renames; physical AnnotationPages expose their current `raw.githubusercontent.com` source through `seeAlso`.
* Added creator/editor metadata for Mirador user annotations, using the authenticated GitHub login for GitHub-backed workspaces and an options-page display name as fallback.
* Moved GitHub workspace repository selection, creation, rename and deletion into the popup Workspaces tab.
* Added `workspace.json` magic-file detection so detektIIIF only lists GitHub repositories marked as detektIIIF workspaces.
* Added the private reserved GitHub registry repository `detektiiif-workspace-registry`, which stores minimal links to workspace repositories and avoids broad GitHub repository scans.
* Added popup initialization for existing empty GitHub repositories by entering their repository name in the create-workspace dialog.
* Added GitHub workspace sharing in the popup with repository-link copying, private/public visibility controls, Viewer/Editor invitations, collaborator removal, and pending-invitation cancellation.
* Disabled and removed automatic GitHub workspace polling to avoid continuous API traffic and rate-limit exhaustion.
* Disabled verbose background-page debug logging while retaining actionable warnings and errors.
* Removed unused Content, Devtools, New Tab, Panel and Greetings boilerplate together with obsolete TypeScript build tooling.
* Added local journaling for pending annotation edits until their debounced backend write succeeds.
* Added three bounded annotation-write retries, visible Mirador save status, and a manual Retry action after the final failure.
* Added opening shared workspace repositories by GitHub URL or `owner/repository`; public workspaces can be read without a PAT.
* Added GitHub permission-aware read-only behavior in the popup, Mirador configuration, and annotation adapter.
* Added a blocking progress overlay for workspace and GitHub repository operations in the popup.
* Added lazy loading, local caching and browser-wide locking for GitHub workspace repository lookup to avoid repeated high-volume GitHub API requests.
* Fixed open Mirador pages staying pinned to the old `?workspace=` URL after the active workspace was changed elsewhere in the extension.
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
* Generic semantic link discovery that tests linked resources when their URL, visible text, accessibility label or link metadata mentions IIIF or manifests.
* Courtauld and generic semantic-link fixtures covering relative and neutrally named IIIF resource URLs.
* Workspace popup test covering add, create, rename and delete behavior.
* Mirador annotation persistence test for workspace-scoped annotations.
* Options-page test covering workspace storage backend selection and GitHub settings persistence.
* Popup test covering GitHub workspace repository listing, creation, rename and deletion.
* Popup tests covering GitHub workspace sharing and anonymous read-only access to public workspace repositories.

### Fixed

* Domain filtering now handles URLs with ports through `new URL(url).hostname`.
* Ignored-domain matching now uses exact host/subdomain matching instead of loose suffix checks, normalizes option input, and skips DOM scans on ignored hosts.
* Ignored domains stored in `chrome.storage.local` are now loaded and observed by the background script.
* Image API URL detection now accepts both `http` and `https`.
* Relative IIIF links discovered in page HTML are now resolved against the page URL before they are fetched and validated.
* URLs containing both `iiif` and `manifest` now fall back to `GET` when a server returns a misleading non-JSON content type for `HEAD`, as seen on Courtauld collection pages.
* Tab script injection now waits for `changeInfo.status === 'complete'`.
* HEAD fallback handling no longer caches known 405/500 fallback cases as rejected before trying GET.
* Stored tab state is normalized defensively when loaded from `chrome.storage.local`.
* Workspace storage operations now surface `chrome.runtime.lastError` failures such as sync-storage quota errors.
* Workspace annotations no longer hit Chrome's `Resource::kQuotaBytesPerItem quota exceeded` limit for normal large annotation payloads.
* Rapid Mirador annotation updates no longer exhaust Chrome's `MAX_WRITE_OPERATIONS_PER_MINUTE` sync-storage quota under normal editing.
* `Clear Workspace` now removes both collected manifests and workspace annotations from the configured storage backend.
* Mirador no longer re-renders while annotation-only workspace writes are being persisted.
* Popup and Mirador now also react to chunked workspace-index changes and local workspace storage backend changes.
* Workspace mutations now reload the latest backend state immediately before applying and writing the requested change.
* Browser Sync mutations now use a browser-wide Web Lock to prevent popup and Mirador contexts from overwriting each other.
* GitHub mutations now use optimistic SHA checks and retry against the latest workspace after concurrent writes.
* Failed GitHub data uploads no longer expose a partially updated workspace, because the root pointer is published only after all revision files succeed.
* The reserved GitHub workspace registry is now rejected when an existing repository with that name is public.
* Failed annotation-ID resolution can now be retried instead of remaining cached as a rejected promise.
* Mirador resumes a deferred workspace switch automatically after pending annotation writes are successfully retried.
* DOM discovery now returns bounded URL candidates directly from script injection instead of sending complete page HTML, and stale navigation results are rejected by tab generation.
* Newly excluded domains now clear already detected tab results immediately without requiring a page reload.
* Collaborative annotation writes now use a three-way merge by annotation ID, preserving unrelated remote additions and changes.
* Mirador annotation caches and pending writes are now bound to the concrete storage backend and GitHub repository.
* Clear protection is now tracked per storage backend, repository and workspace instead of using one global marker.
* Detected IIIF resources are reset on same-tab navigation, and delayed responses from the previous page are ignored.
* Corrupt or incomplete workspace chunks and GitHub JSON files now surface an error instead of silently becoming empty workspaces.
* Popup workspace loads now discard stale asynchronous responses, and persisted `showUrl` state is reflected correctly on the options page.
* Generic discovery no longer treats `collection` alone as an IIIF clue, and generic HEAD-to-GET fallback requires both `iiif` and `manifest` in the URL.
* Text-button tooltips in the popup now act as accessible descriptions instead of replacing button names.
* GitHub workspace repository listing now remains usable when the previously selected repository is missing or not a detektIIIF workspace.
* Workspace operation failures now stay visible in a dismissible dialog instead of disappearing as transient snackbars.
* Popup GitHub workspace actions now update the local repository list cache and registry entry after each create, switch, rename or delete operation.
* GitHub workspace files are segmented around 512 KiB and guarded by a 900 KiB per-file safety limit; version 1 repositories migrate on their next write.
* Mirador discards stale asynchronous render results when a newer workspace or backend selection supersedes them.
* Annotation updates now preserve the original creator while replacing `lastEditor` and save timestamps with the current editor and time.
* Navigating from a detected page to an ignored or unsupported URL now clears stale resources and badge state immediately.

### Notes

* The browser extension version and the active theme manifest version are both set to `4.0.0`.
* The repository and default theme folder still use the historical `detektiiif3` path/name where changing it would affect local paths or project history.
* Firefox lint currently reports known bundled third-party warnings, but no extension lint errors.
* Workspace annotations are stored in browser sync storage as requested. The chunked and debounced model avoids the common per-item and rapid-write quotas, but browser sync storage still has total and sustained-write quotas; a local or external annotation backend remains sensible for very large or collaborative workflows.
* `npm audit` still reports upstream issues in `quill@2.0.3` via `mirador-annotation-editor` and `image-size` via `web-ext` tooling.
