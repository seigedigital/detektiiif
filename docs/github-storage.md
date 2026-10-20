# GitHub Storage For Workspaces And Annotations

Status: 2026-09-19

detektIIIF can store workspaces and Mirador annotations in GitHub repositories instead of browser sync storage. One repository is one workspace. detektIIIF keeps a private registry repository named `detektiiif-workspace-registry` in the authenticated GitHub account. That registry contains only links to detektIIIF workspace repositories; workspace details are read from the linked repositories themselves.

## 1. Registry And Workspace Repositories

The normal setup path is fully inside detektIIIF:

1. Configure GitHub Storage with a PAT in the options page.
2. Open the popup Workspaces tab.
3. Create a workspace repository there, or enter an existing repository name to initialize/register it.

When the registry repository is missing, detektIIIF creates it as a private repository and writes this magic file:

```text
registry.json
```

The file has `generatedBy: "detektIIIF"` and `type: "detektIIIF:WorkspaceRegistry"`. It stores minimal entries like `owner`, `repo`, and `workspaceId`. It does not duplicate workspace names, items, annotations, or other workspace details.

The reserved registry repository must remain private. detektIIIF refuses to use an existing public repository with this reserved name, so workspace links are not exposed accidentally.

Each workspace repository is still identified by its own root-level magic file:

```text
workspace.json
```

If you want to create a workspace repository manually in GitHub:

1. Sign in to GitHub.
2. Select `+` in the upper right corner and open `New repository`.
3. Choose a short name, for example `detektiiif-workspace-seminar`.
4. Choose `Private` or `Public` as needed. `Private` is usually the better choice for personal annotations.
5. Either add a valid `workspace.json` magic file yourself, or let detektIIIF initialize the repository from the popup create action.
6. After creating the repository, note its repository address, for example:

```text
seigedigital/detektiiif-workspace-seminar
```

detektIIIF also accepts GitHub URLs such as:

```text
https://github.com/seigedigital/detektiiif-workspace-seminar
git@github.com:seigedigital/detektiiif-workspace-seminar.git
```

Internally, this becomes `owner/repository`.

For ordinary use, continue with the PAT setup and create or initialize repositories from the popup. detektIIIF does not scan your GitHub account for matching repositories.

## 2. Create A Fine-Grained PAT

1. Open `Settings` in GitHub.
2. Open `Developer settings`.
3. Open `Personal access tokens`, then `Fine-grained tokens`.
4. Choose `Generate new token`.
5. Enter a name, for example `detektIIIF Workspace`.
6. Set an expiration date.
7. Under `Resource owner`, choose the account or organization that owns the repositories.
8. Under `Repository access`, choose the registry repository and all workspace repositories detektIIIF should use. If detektIIIF should create the registry or new workspace repositories itself, the token must be allowed to access newly created repositories as well; depending on GitHub and organization settings, `All repositories` may be required.
9. If you use selected repositories, select `detektiiif-workspace-registry` and the detektIIIF workspace repositories.
10. Under `Repository permissions`, set `Contents` to `Read and write`.
11. Optional, if detektIIIF should create, rename or delete repositories, change visibility, or manage collaborators from the popup: set `Administration` to `Read and write`.
12. Create the token and copy the displayed value immediately.

No other permissions are intended for detektIIIF. In particular, detektIIIF does not need `Workflows` permission because it does not write files below `.github/workflows`. Without `Administration`, detektIIIF can store workspaces and annotations in already accessible detektIIIF workspace repositories, but it cannot create, rename or delete repositories or manage sharing.

Note: If `detektiiif-workspace-registry` does not exist yet, detektIIIF needs permission to create that private repository. If repository creation is blocked by token scope or organization policy, create the registry repository manually with the exact name `detektiiif-workspace-registry`, give the PAT access to it, and let detektIIIF initialize `registry.json`.

### PATs For Invited Collaborators

Fine-grained PATs are the preferred choice for repositories you own and organization repositories where you are a member. GitHub currently does not support using a fine-grained PAT to contribute to a repository where the user is only an outside or repository collaborator.

An invited participant who needs to edit such a private shared workspace therefore currently needs a personal access token (classic) with the `repo` scope. This scope can grant access to every private repository the participant can access, so use a short expiration, protect the token carefully, and prefer an institution-owned organization or future dedicated backend for larger deployments. A participant who only reads a public workspace does not need any PAT.

Important: GitHub shows the token only once. Do not put it into issues, commits, screenshots, chat messages, or shared documents.

## 3. Enable GitHub Storage In detektIIIF

1. Open the detektIIIF options page.
2. Expand `Workspace Storage`.
3. Under `Storage Backend`, choose `GitHub Storage`.
4. Optionally enter an `Annotation display name`. GitHub storage normally records the authenticated GitHub login from the PAT as annotation creator/editor; this name is used as a fallback.
5. Paste the fine-grained PAT into `Personal access token`.
6. Run `Save Storage Settings`.

## 4. Create, Open, Select Or Delete A Workspace Repository In detektIIIF

The repository does not have to exist before configuring detektIIIF. In the popup Workspaces tab, detektIIIF can create a new GitHub workspace repository or initialize an existing empty repository:

1. Open the popup.
2. Open `Workspaces`.
3. Use the create icon.
4. Enter a repository name such as `detektiiif-workspace-seminar`, or `owner/name` for an organization repository.

If no owner is given, detektIIIF uses the GitHub account authenticated by the token. If `owner/name` is entered, detektIIIF uses that owner. When the repository already exists and has no conflicting `workspace.json`, detektIIIF writes the magic file, registers it in `detektiiif-workspace-registry`, and selects it. When the repository does not exist, detektIIIF creates it as private by default, initializes it, registers it, and automatically selects it as the current workspace.

Repository deletion is available from the same Workspaces controls and asks for browser confirmation. After that, the whole GitHub repository is deleted, it is removed from the registry, and the repository selection in detektIIIF is cleared. The PAT remains stored locally so another repository can be configured afterwards.

The folder icon opens a workspace shared by someone else. Paste either its GitHub URL or `owner/repository`. detektIIIF accepts it only when the root-level `workspace.json` contains the detektIIIF magic metadata.

* A public repository can be opened without a PAT and is read-only.
* A private repository requires a PAT whose GitHub account has access to that repository.
* An invited user must accept the GitHub repository invitation before the private workspace can be opened.
* GitHub `pull` access is shown as Viewer and remains read-only.
* GitHub `push`, `maintain`, or `admin` access permits workspace and annotation changes.

Private repositories owned by personal GitHub accounts only offer collaborator write access. Use an organization-owned repository when a private workspace needs distinct Viewer and Editor roles.

To avoid GitHub rate limits, detektIIIF does not scan `/user/repos`. The popup dropdown is built from `detektiiif-workspace-registry/registry.json` and then validates each linked repository by reading its `workspace.json`. If an accessible repository is not listed, use the create icon and enter `owner/name`; detektIIIF will initialize/select and register that repository directly.

## 5. What detektIIIF Stores In The Repository

detektIIIF uses the repository's default branch. API base URLs, branches, and base paths are not configurable.

`workspace.json` remains at the repository root. Version 3 data files live in immutable revision directories:

```text
workspace.json
revisions/<revision-id>/items/0001.json
revisions/<revision-id>/items/0002.json
revisions/<revision-id>/annotations/index/0001.json
revisions/<revision-id>/annotations/<canvas-id-hash>/0001.json
revisions/<revision-id>/annotations/<canvas-id-hash>/0002.json
```

`workspace.json` contains versioned workspace metadata, identifies the repository as a detektIIIF workspace through `generatedBy: "detektIIIF"` and `type: "detektIIIF:Workspace"`, and points to segmented item and annotation-index files. Annotation data is stored as IIIF/Web Annotation compatible `AnnotationPage` JSON. A canvas may use several AnnotationPage files when its data is large.

For each mutation, detektIIIF uploads all changed files under a new revision ID before updating `workspace.json`. That final update uses the SHA read with the original workspace. If another participant published first, GitHub rejects the stale SHA; detektIIIF then reloads the new state, reapplies the requested change and retries. A failed data upload therefore cannot make a half-written revision visible. Unchanged files may remain referenced from older revisions, and obsolete files are deleted after a successful publish on a best-effort basis.

detektIIIF targets about 512 KiB per generated data file and refuses to write a file above its 900 KiB safety limit. This keeps files within the reliable range of the GitHub Contents API. A single annotation or manifest entry that exceeds the safety limit cannot be split automatically and must be reduced. Existing version 1 and 2 repositories remain readable and are migrated to the revision-based version 3 layout on their next write.

detektIIIF records creator/editor metadata on user annotations. The original `creator` is preserved, while `lastEditor`, `lastSavedDate`, and `modified` are replaced on every update. With GitHub storage, the editor name is the GitHub login authenticated by the PAT when it can be resolved.

When `Clear Workspace` is used in the popup, `workspace.json` is published as an empty workspace, so no collected manifests or annotations remain reachable through the workspace. Previously referenced data files are then removed on a best-effort basis.

## 6. Collaboration And Access Management

GitHub handles access control, while the popup exposes the common sharing operations. Select a GitHub workspace and use the share icon to:

* copy the GitHub repository link;
* switch an administered repository between private and public;
* invite a GitHub user as Viewer or Editor;
* see accepted collaborators and pending invitations;
* remove a direct collaborator or cancel a pending invitation.

The roles map to GitHub permissions:

* Viewer uses `pull` and can read the workspace.
* Editor uses `push` and can change workspace data and annotations.
* `Maintain` or `Admin` can perform additional repository actions depending on GitHub configuration.

Only repository administrators can change visibility or manage collaborators. GitHub sends repository invitations; invitees accept them in GitHub. Organization policies can prohibit outside collaborators or fine-grained PAT actions. Access inherited through organizations or teams remains managed in GitHub, because removing a direct collaborator cannot revoke a stronger inherited role.

Public workspaces are readable in detektIIIF without credentials. Private workspaces require each participant to configure their own PAT; tokens are never shared through the workspace repository. detektIIIF derives read-only/editor behavior from the permissions GitHub returns and disables manifest, clear, and Mirador annotation writes for Viewers.

This is asynchronous collaboration through GitHub commits, not simultaneous live editing. Before writing, detektIIIF reloads the current repository data and merges the requested change into it. AnnotationPages are merged by annotation ID, so unrelated additions made by another participant are retained. A stale `workspace.json` SHA triggers a fresh read and retry. If two participants repeatedly change or delete the same annotation, the last successfully published edit still wins.

detektIIIF does not poll GitHub automatically. Reopen Mirador or reselect the workspace in the popup to load changes made by collaborators. This keeps API usage predictable and avoids background requests while a workspace remains open.

Annotation writes are journaled locally and retried three times with bounded backoff after a failure. Mirador shows the current save state. If all automatic attempts fail, the message remains visible with a manual Retry action; the journal is kept until a write succeeds or the workspace is explicitly cleared.

## 7. Annotation IDs And Raw Access

With GitHub storage enabled, detektIIIF assigns each workspace a stable UUID-based URI. AnnotationPage and annotation IDs are derived from it:

```text
https://detektiiif.net/workspaces/<workspace-id>/annotations/<canvas-id>#<annotation-id>
```

These IDs do not contain the GitHub owner, repository name, or branch and therefore remain stable when a repository is renamed. The namespace is reserved for a future detektIIIF or institution-specific resolver.

Each physical AnnotationPage contains a `seeAlso` entry with its current raw source:

```text
https://raw.githubusercontent.com/<owner>/<repo>/<branch>/revisions/<revision-id>/annotations/<canvas-id-hash>/<part>.json
```

Other software can fetch that source directly for public repositories. `workspace.json` also records the current repository URL and the segmented file index. Annotation identity and raw transport are deliberately separate.

For private repositories, raw sources are not publicly fetchable. Other software still needs suitable GitHub access.

## 8. Security And Operations

A dedicated repository only for detektIIIF data is recommended. This keeps the PAT narrowly scoped and makes commits easy to audit.

In a private repository, workspaces and annotations are not publicly visible, but every person with repository access can read the data. In a public repository, stored manifest lists and annotations are public.

If the token is lost or compromised:

1. Delete or regenerate the token in GitHub immediately.
2. Enter the new token in the detektIIIF options.
3. Optionally inspect the repository for unexpected commits.

## 9. Troubleshooting

`GitHub connection failed: 404` usually means that the repository name, owner, or token access does not match. Check whether the PAT selects exactly this repository.

`403` usually means missing permissions or an organization policy. Check whether fine-grained PATs are allowed for the organization and whether `Contents: Read and write` is set. Repository create, rename and delete additionally need `Administration: Read and write`.

Sharing, visibility changes, collaborator removal, and invitation cancellation also need `Administration: Read and write`. GitHub may still reject outside collaborators because of organization or enterprise policy.

`409 Conflict` can occur shortly after creating an empty repository while GitHub is still preparing it. Wait briefly and try saving again. A permanently empty Git state should be initialized automatically during the first detektIIIF write operation.

If no repository is listed in the popup, detektIIIF did not find accessible repositories in `detektiiif-workspace-registry/registry.json` that also contain a valid `workspace.json` magic file. To use an accessible empty or older repository, use the create icon and enter its repository name; detektIIIF will initialize and register it instead of creating a duplicate.

If GitHub reports an API rate limit, wait until GitHub allows requests again. detektIIIF will reuse a cached workspace list where possible. The registry model avoids broad repository scans, and Mirador pages do not poll GitHub in the background.

If create, rename or delete does not work, `Administration: Read and write` is usually missing from the fine-grained PAT, or the organization does not allow this action for the token.

## Sources

* GitHub Docs: Creating a new repository: https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-new-repository
* GitHub Docs: Managing personal access tokens: https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens
* GitHub Docs: REST API endpoints for repositories: https://docs.github.com/en/rest/repos/repos
* GitHub Docs: REST API endpoints for repository contents: https://docs.github.com/en/rest/repos/contents
* GitHub Docs: REST API endpoints for collaborators: https://docs.github.com/en/rest/collaborators/collaborators
* GitHub Docs: REST API endpoints for repository invitations: https://docs.github.com/en/rest/collaborators/invitations
