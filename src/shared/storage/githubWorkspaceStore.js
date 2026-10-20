import { v4, v5 } from 'uuid'

const GITHUB_API_BASE_URL = 'https://api.github.com'
const GITHUB_CONTENT_API_VERSION = '2022-11-28'
const GITHUB_REPOSITORY_WORKSPACE_VERSION = 3
const GITHUB_RAW_CONTENT_BASE_URL = 'https://raw.githubusercontent.com'
const GITHUB_WEB_BASE_URL = 'https://github.com'
const GITHUB_REPOSITORY_WORKSPACE_ID = 'default'
const GITHUB_REPOSITORY_WORKSPACE_TYPE = 'detektIIIF:Workspace'
const GITHUB_WORKSPACE_REGISTRY_REPOSITORY_NAME = 'detektiiif-workspace-registry'
const GITHUB_WORKSPACE_REGISTRY_PATH = 'registry.json'
const GITHUB_WORKSPACE_REGISTRY_TYPE = 'detektIIIF:WorkspaceRegistry'
const GITHUB_WORKSPACE_REGISTRY_VERSION = 1
const GITHUB_WORKSPACE_REPOSITORY_CACHE_KEY = 'githubWorkspaceRepositoryCache'
const GITHUB_WORKSPACE_REPOSITORY_CACHE_TTL_MS = 5 * 60 * 1000
const GITHUB_WORKSPACE_REPOSITORY_DISCOVERY_LOCK_TTL_MS = 15 * 1000
const GITHUB_WORKSPACE_REPOSITORY_DISCOVERY_POLL_MS = 250
const GITHUB_FILE_TARGET_BYTES = 512 * 1024
const GITHUB_FILE_MAX_BYTES = 900 * 1024
const CANVAS_PATH_NAMESPACE = 'd0a94a73-66f8-43c9-92f4-019802a2a4c4'
const DETEKTIIIF_ANNOTATION_BASE_URL = 'https://detektiiif.net/workspaces'
const FALLBACK_ANNOTATION_NAMESPACE = '13d684a1-6f80-4e41-83f3-8746fce2ee0d'
const WORKSPACE_URI_NAMESPACE = '8145c7ea-a846-4eb3-8d82-fbf3f7dc624e'
const gitHubWorkspaceRepositoryListPromises = new Map()

function getStorageError() {
  const lastError = chrome.runtime && chrome.runtime.lastError

  return lastError ? new Error(lastError.message) : null
}

function localStorageGet(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (result) => {
      const error = getStorageError()
      if (error) {
        reject(error)
        return
      }

      resolve(result || {})
    })
  })
}

function localStorageSet(data) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(data, () => {
      const error = getStorageError()
      if (error) {
        reject(error)
        return
      }

      resolve()
    })
  })
}

function joinPath(...parts) {
  return parts
    .filter((part) => part !== undefined && part !== null && String(part).trim() !== '')
    .map((part) => String(part).trim().replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/')
}

function encodePathForApi(path) {
  return String(path)
    .split('/')
    .map(encodeURIComponent)
    .join('/')
}

function encodePathForWeb(path) {
  return encodePathForApi(path)
}

function encodeGitHubBase64(value) {
  const bytes = new TextEncoder().encode(value)
  let binary = ''

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })

  return btoa(binary)
}

function decodeGitHubBase64(value) {
  const binary = atob(String(value || '').replace(/\s/g, ''))
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return new TextDecoder().decode(bytes)
}

function serializeGitHubJSON(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

function getSerializedByteLength(value) {
  return new TextEncoder().encode(serializeGitHubJSON(value)).length
}

function assertGitHubFileSize(value, description) {
  const byteLength = getSerializedByteLength(value)

  if (byteLength > GITHUB_FILE_MAX_BYTES) {
    throw new Error(
      `${description || 'GitHub workspace data'} is too large for one GitHub file ` +
      `(${byteLength} bytes). Split the item into smaller annotations or resources.`
    )
  }

  return byteLength
}

function splitValuesBySize(values, buildValue, description) {
  const chunks = []
  let current = []

  values.forEach((value) => {
    const candidate = [...current, value]
    const candidateValue = buildValue(candidate, chunks.length)
    const candidateSize = getSerializedByteLength(candidateValue)

    if (current.length > 0 && candidateSize > GITHUB_FILE_TARGET_BYTES) {
      chunks.push(current)
      current = [value]
      assertGitHubFileSize(buildValue(current, chunks.length), description)
      return
    }

    assertGitHubFileSize(candidateValue, description)
    current = candidate
  })

  if (current.length > 0) {
    chunks.push(current)
  }

  return chunks
}

function formatFilePart(index) {
  return String(index + 1).padStart(4, '0')
}

function createStableWorkspaceUri(seed = '') {
  const identifier = seed ? v5(String(seed), WORKSPACE_URI_NAMESPACE) : v4()

  return `${DETEKTIIIF_ANNOTATION_BASE_URL}/${identifier}`
}

function getStableWorkspaceUri(metadata, config, repository) {
  const existingId = String(metadata?.id || '')

  if (existingId.startsWith(`${DETEKTIIIF_ANNOTATION_BASE_URL}/`)) {
    return existingId.replace(/\/+$/, '')
  }

  const seed = repository?.id
    ? `github-repository:${repository.id}`
    : existingId || `github-repository:${config.owner.toLowerCase()}/${config.repo.toLowerCase()}`

  return createStableWorkspaceUri(seed)
}

function getStableAnnotationPageUri(workspaceUri, canvasId) {
  return `${workspaceUri}/annotations/${v5(String(canvasId), CANVAS_PATH_NAMESPACE)}`
}

function parseGitHubJSON(value, fallback, options = {}) {
  if (!value) {
    return fallback
  }

  try {
    return JSON.parse(value)
  } catch (error) {
    if (options.strict) {
      throw new Error(`Could not parse ${options.description || 'GitHub workspace JSON'}: ${error.message}`)
    }

    console.warn('Could not parse GitHub workspace storage JSON.', error)
    return fallback
  }
}

function getTokenFingerprint(token) {
  const value = String(token || '')
  let hash = 2166136261

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return `${value.length}:${(hash >>> 0).toString(36)}`
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function getCacheAge(cache) {
  return Date.now() - Date.parse(cache?.updatedAt || '')
}

function normalizeRepoPart(value, name) {
  const normalized = String(value || '').trim()

  if (!normalized) {
    throw new Error(`GitHub workspace storage needs a ${name}.`)
  }

  return normalized
}

function normalizeGitHubConfig(config) {
  return {
    defaultBranch: String(config?.defaultBranch || '').trim(),
    owner: normalizeRepoPart(config?.owner, 'owner'),
    repo: normalizeRepoPart(config?.repo, 'repository').replace(/\.git$/i, ''),
    token: String(config?.token || '').trim(),
  }
}

function normalizeAuthenticatedGitHubConfig(config) {
  return {
    ...normalizeGitHubConfig(config),
    token: normalizeRepoPart(config?.token, 'personal access token'),
  }
}

function normalizeGitHubTokenConfig(config) {
  return {
    token: normalizeRepoPart(config?.token, 'personal access token'),
  }
}

function buildRepoApiUrl(config) {
  return `${GITHUB_API_BASE_URL}/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}`
}

function buildAuthenticatedUserApiUrl() {
  return `${GITHUB_API_BASE_URL}/user`
}

function buildAuthenticatedUserRepositoriesApiUrl() {
  return `${GITHUB_API_BASE_URL}/user/repos`
}

function buildOrganizationRepositoriesApiUrl(owner) {
  return `${GITHUB_API_BASE_URL}/orgs/${encodeURIComponent(owner)}/repos`
}

function buildContentApiUrl(config, path) {
  return `${buildRepoApiUrl(config)}/contents/${encodePathForApi(path)}`
}

function buildCollaboratorApiUrl(config, username = '') {
  const suffix = username ? `/${encodeURIComponent(username)}` : ''
  const query = username ? '' : '?per_page=100'

  return `${buildRepoApiUrl(config)}/collaborators${suffix}${query}`
}

function buildRepositoryInvitationsApiUrl(config, invitationId = '') {
  const suffix = invitationId ? `/${encodeURIComponent(invitationId)}` : ''
  const query = invitationId ? '' : '?per_page=100'

  return `${buildRepoApiUrl(config)}/invitations${suffix}${query}`
}

function isDetektIIIFWorkspaceMetadata(value) {
  return (
    value &&
    typeof value === 'object' &&
    value.generatedBy === 'detektIIIF' &&
    value.type === GITHUB_REPOSITORY_WORKSPACE_TYPE
  )
}

function isDetektIIIFWorkspaceRegistry(value) {
  return (
    value &&
    typeof value === 'object' &&
    value.generatedBy === 'detektIIIF' &&
    value.type === GITHUB_WORKSPACE_REGISTRY_TYPE
  )
}

function parseRepositoryIdentifier(value) {
  const repository = String(value || '')
    .trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/^git@github\.com:/i, '')
    .replace(/\.git$/i, '')
    .replace(/^\/+|\/+$/g, '')
  const parts = repository.split('/').filter(Boolean)

  return parts.length >= 2
    ? { owner: parts[0], repo: parts[1].replace(/\.git$/i, '') }
    : { owner: '', repo: '' }
}

function normalizeGitHubWorkspaceRegistryEntry(repository) {
  const parsed = typeof repository === 'string'
    ? parseRepositoryIdentifier(repository)
    : { owner: '', repo: '' }
  const owner = repository?.owner?.login || repository?.owner || parsed.owner || ''
  const repo = repository?.repo || repository?.name || parsed.repo || ''

  if (!owner || !repo) {
    return null
  }

  return {
    owner,
    repo,
    workspaceId: repository?.workspaceId || GITHUB_REPOSITORY_WORKSPACE_ID,
  }
}

function getGitHubWorkspaceRegistryEntryKey(entry) {
  const owner = String(entry?.owner || '').trim().toLowerCase()
  const repo = String(entry?.repo || '').trim().toLowerCase()

  return owner && repo ? `${owner}/${repo}` : ''
}

function sortGitHubWorkspaceRegistryEntries(entries) {
  const byKey = new Map()

  entries
    .map(normalizeGitHubWorkspaceRegistryEntry)
    .filter(Boolean)
    .forEach((entry) => {
      byKey.set(getGitHubWorkspaceRegistryEntryKey(entry), entry)
    })

  return Array.from(byKey.values()).sort((a, b) => (
    `${a.owner}/${a.repo}`.localeCompare(`${b.owner}/${b.repo}`)
  ))
}

function createGitHubWorkspaceRegistry(entries = []) {
  return {
    generatedBy: 'detektIIIF',
    type: GITHUB_WORKSPACE_REGISTRY_TYPE,
    updatedAt: new Date().toISOString(),
    version: GITHUB_WORKSPACE_REGISTRY_VERSION,
    workspaces: sortGitHubWorkspaceRegistryEntries(entries),
  }
}

function normalizeGitHubWorkspaceRegistry(value) {
  return createGitHubWorkspaceRegistry(
    Array.isArray(value?.workspaces) ? value.workspaces : []
  )
}

function getRepositorySummaryKey(repository) {
  const owner = repository?.owner || ''
  const repo = repository?.repo || repository?.name || ''

  return repository?.fullName || repository?.id || (owner && repo ? `${owner}/${repo}` : '')
}

function normalizeGitHubWorkspaceRepositorySummary(repository) {
  const owner = repository?.owner?.login || repository?.owner || ''
  const repo = repository?.repo || repository?.name || ''
  const fullName = repository?.fullName || repository?.full_name || (owner && repo ? `${owner}/${repo}` : '')

  if (!fullName) {
    return null
  }

  return {
    defaultBranch: repository?.defaultBranch || repository?.default_branch || 'main',
    fullName,
    htmlUrl: repository?.htmlUrl || repository?.html_url || `${GITHUB_WEB_BASE_URL}/${fullName}`,
    id: repository?.id || fullName,
    name: repository?.name || repo || fullName.split('/').pop(),
    owner: owner || fullName.split('/')[0],
    permissions: repository?.permissions || {},
    private: Boolean(repository?.private),
    repo: repo || fullName.split('/').pop(),
    updatedAt: repository?.updatedAt || repository?.updated_at || '',
    workspaceId: repository?.workspaceId || GITHUB_REPOSITORY_WORKSPACE_ID,
  }
}

function sortGitHubWorkspaceRepositorySummaries(repositories) {
  return repositories
    .map(normalizeGitHubWorkspaceRepositorySummary)
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name))
}

function isGitHubRateLimitError(error) {
  const message = String(error?.message || '').toLowerCase()

  return (
    error?.status === 429 ||
    (
      error?.status === 403 &&
      (
        message.includes('rate limit') ||
        message.includes('secondary rate') ||
        message.includes('abuse detection')
      )
    )
  )
}

async function readGitHubWorkspaceRepositoryCache(rawConfig, options = {}) {
  const token = normalizeRepoPart(rawConfig?.token, 'personal access token')
  const tokenFingerprint = getTokenFingerprint(token)
  const data = await localStorageGet(GITHUB_WORKSPACE_REPOSITORY_CACHE_KEY)
  const cache = data[GITHUB_WORKSPACE_REPOSITORY_CACHE_KEY]
  const age = getCacheAge(cache)

  if (
    cache?.tokenFingerprint !== tokenFingerprint ||
    !Array.isArray(cache?.repositories)
  ) {
    return null
  }

  if (cache.pending && !options.allowPending) {
    return null
  }

  if (!options.allowStale && (!Number.isFinite(age) || age > GITHUB_WORKSPACE_REPOSITORY_CACHE_TTL_MS)) {
    return null
  }

  return sortGitHubWorkspaceRepositorySummaries(cache.repositories)
}

async function claimGitHubWorkspaceRepositoryDiscovery(rawConfig) {
  const token = normalizeRepoPart(rawConfig?.token, 'personal access token')
  const tokenFingerprint = getTokenFingerprint(token)
  const data = await localStorageGet(GITHUB_WORKSPACE_REPOSITORY_CACHE_KEY)
  const cache = data[GITHUB_WORKSPACE_REPOSITORY_CACHE_KEY]
  const age = getCacheAge(cache)
  const hasActiveLock = (
    cache?.tokenFingerprint === tokenFingerprint &&
    cache.pending &&
    Number.isFinite(age) &&
    age < GITHUB_WORKSPACE_REPOSITORY_DISCOVERY_LOCK_TTL_MS
  )

  if (hasActiveLock) {
    return { claimed: false }
  }

  const lockId = `${Date.now()}:${Math.random().toString(36).slice(2)}`
  const repositories = (
    cache?.tokenFingerprint === tokenFingerprint &&
    Array.isArray(cache?.repositories)
  )
    ? cache.repositories
    : []

  await localStorageSet({
    [GITHUB_WORKSPACE_REPOSITORY_CACHE_KEY]: {
      lockId,
      pending: true,
      repositories,
      tokenFingerprint,
      updatedAt: new Date().toISOString(),
    },
  })

  const verified = await localStorageGet(GITHUB_WORKSPACE_REPOSITORY_CACHE_KEY)
  const verifiedCache = verified[GITHUB_WORKSPACE_REPOSITORY_CACHE_KEY]

  return { claimed: verifiedCache?.lockId === lockId, lockId }
}

async function waitForGitHubWorkspaceRepositoryDiscovery(rawConfig) {
  const token = normalizeRepoPart(rawConfig?.token, 'personal access token')
  const tokenFingerprint = getTokenFingerprint(token)
  const deadline = Date.now() + GITHUB_WORKSPACE_REPOSITORY_DISCOVERY_LOCK_TTL_MS

  while (Date.now() < deadline) {
    const data = await localStorageGet(GITHUB_WORKSPACE_REPOSITORY_CACHE_KEY)
    const cache = data[GITHUB_WORKSPACE_REPOSITORY_CACHE_KEY]
    const age = getCacheAge(cache)
    const isSameToken = cache?.tokenFingerprint === tokenFingerprint
    const hasFreshLock = (
      isSameToken &&
      cache.pending &&
      Number.isFinite(age) &&
      age < GITHUB_WORKSPACE_REPOSITORY_DISCOVERY_LOCK_TTL_MS
    )

    if (
      isSameToken &&
      !cache.pending &&
      Array.isArray(cache.repositories)
    ) {
      return sortGitHubWorkspaceRepositorySummaries(cache.repositories)
    }

    if (!hasFreshLock) {
      return null
    }

    await delay(GITHUB_WORKSPACE_REPOSITORY_DISCOVERY_POLL_MS)
  }

  return null
}

async function writeGitHubWorkspaceRepositoryCache(rawConfig, repositories) {
  const token = normalizeRepoPart(rawConfig?.token, 'personal access token')

  await localStorageSet({
    [GITHUB_WORKSPACE_REPOSITORY_CACHE_KEY]: {
      repositories: sortGitHubWorkspaceRepositorySummaries(repositories),
      tokenFingerprint: getTokenFingerprint(token),
      updatedAt: new Date().toISOString(),
    },
  })
}

async function rememberGitHubWorkspaceRepository(rawConfig, repository) {
  const cachedRepositories = await readGitHubWorkspaceRepositoryCache(rawConfig, {
    allowPending: true,
    allowStale: true,
  }) || []
  const nextRepository = normalizeGitHubWorkspaceRepositorySummary(repository)

  if (!nextRepository) {
    return cachedRepositories
  }

  await addGitHubWorkspaceRepositoryToRegistry(rawConfig, nextRepository)

  const nextRepositories = cachedRepositories.filter((item) => (
    getRepositorySummaryKey(item) !== getRepositorySummaryKey(nextRepository)
  ))
  nextRepositories.push(nextRepository)

  await writeGitHubWorkspaceRepositoryCache(rawConfig, nextRepositories)

  return sortGitHubWorkspaceRepositorySummaries(nextRepositories)
}

async function forgetGitHubWorkspaceRepository(rawConfig, repository) {
  const repositoryKey = typeof repository === 'string'
    ? repository
    : getRepositorySummaryKey(repository)
  const cachedRepositories = await readGitHubWorkspaceRepositoryCache(rawConfig, {
    allowPending: true,
    allowStale: true,
  }) || []
  const nextRepositories = cachedRepositories.filter((item) => (
    getRepositorySummaryKey(item) !== repositoryKey
  ))

  await removeGitHubWorkspaceRepositoryFromRegistry(rawConfig, repository)
  await writeGitHubWorkspaceRepositoryCache(rawConfig, nextRepositories)

  return sortGitHubWorkspaceRepositorySummaries(nextRepositories)
}

function buildGitHubHeaders(config) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': GITHUB_CONTENT_API_VERSION,
  }

  if (config.token) {
    headers.Authorization = `Bearer ${config.token}`
  }

  return headers
}

async function fetchGitHubJSON(config, url, options = {}, allowNotFound = false) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...buildGitHubHeaders(config),
      ...(options.headers || {}),
    },
  })
  const text = await response.text()
  const body = parseGitHubJSON(text, {})

  if ((response.status === 404 || response.status === 409) && allowNotFound) {
    return null
  }

  if (!response.ok) {
    const message = body.message || text || response.statusText
    const error = new Error(`GitHub API request failed (${response.status}): ${message}`)
    error.body = body
    error.status = response.status
    error.url = url
    throw error
  }

  return body
}

async function readGitHubFile(config, path) {
  const body = await fetchGitHubJSON(
    config,
    buildContentApiUrl(config, path),
    { method: 'GET' },
    true
  )

  if (!body) {
    return null
  }

  if (Array.isArray(body) || body.type === 'dir') {
    throw new Error(`GitHub path is a directory, not a file: ${path}`)
  }

  if (!body.content && Number(body.size) > 0) {
    throw new Error(
      `GitHub workspace file "${path}" is too large for the Contents API. ` +
      'Save the workspace once with a current detektIIIF version to migrate it to segmented storage.'
    )
  }

  const text = decodeGitHubBase64(body.content || '')

  return {
    sha: body.sha,
    text,
    value: parseGitHubJSON(text, {}, {
      description: `GitHub workspace file "${path}"`,
      strict: true,
    }),
  }
}

async function writeGitHubFile(config, path, value, message, options = {}) {
  assertGitHubFileSize(value, `GitHub workspace file "${path}"`)
  const text = serializeGitHubJSON(value)
  const usesExpectedSha = Object.prototype.hasOwnProperty.call(options, 'expectedSha')
  const existing = usesExpectedSha
    ? options.existing || null
    : await readGitHubFile(config, path)

  if (existing && existing.text === text) {
    return existing
  }

  const body = {
    content: encodeGitHubBase64(text),
    message,
  }

  const sha = usesExpectedSha ? options.expectedSha : existing?.sha
  if (sha) {
    body.sha = sha
  }

  return fetchGitHubJSON(config, buildContentApiUrl(config, path), {
    body: JSON.stringify(body),
    method: 'PUT',
  })
}

function isGitHubConflictError(error) {
  return error?.status === 409 || error?.status === 422
}

async function deleteGitHubFile(config, path, message) {
  const existing = await readGitHubFile(config, path)

  if (!existing?.sha) {
    return null
  }

  return fetchGitHubJSON(config, buildContentApiUrl(config, path), {
    body: JSON.stringify({
      message,
      sha: existing.sha,
    }),
    method: 'DELETE',
  })
}

function getRepositoryWorkspacePath() {
  return 'workspace.json'
}

function getRepositoryItemsPartPath(revisionId, index) {
  return joinPath('revisions', revisionId, 'items', `${formatFilePart(index)}.json`)
}

function getRepositoryAnnotationPartPath(revisionId, canvasId, index) {
  return joinPath(
    'revisions',
    revisionId,
    'annotations',
    v5(String(canvasId), CANVAS_PATH_NAMESPACE),
    `${formatFilePart(index)}.json`
  )
}

function getRepositoryAnnotationIndexPath(revisionId, index) {
  return joinPath(
    'revisions',
    revisionId,
    'annotations',
    'index',
    `${formatFilePart(index)}.json`
  )
}

function getRepositoryWorkspaceUri(config) {
  return `${GITHUB_WEB_BASE_URL}/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/tree/${encodeURIComponent(config.defaultBranch || 'main')}`
}

function getRawContentUri(config, path) {
  return `${GITHUB_RAW_CONTENT_BASE_URL}/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/${encodeURIComponent(config.defaultBranch || 'main')}/${encodePathForWeb(path)}`
}

async function getGitHubAnnotationPageUri(rawConfig, _workspaceId, canvasId) {
  const config = normalizeGitHubConfig(rawConfig)
  const { config: resolvedConfig, repository } = await resolveGitHubConfig(config)

  const workspaceFile = await readGitHubFile(resolvedConfig, getRepositoryWorkspacePath())
  const metadata = isDetektIIIFWorkspaceMetadata(workspaceFile?.value)
    ? workspaceFile.value
    : null
  const workspaceUri = getStableWorkspaceUri(metadata, resolvedConfig, repository)

  return getStableAnnotationPageUri(workspaceUri, canvasId)
}

function createAnnotationFallbackId(annotationPageId, annotation, index) {
  const existingId = typeof annotation?.id === 'string' ? annotation.id.trim() : ''
  const fragmentIndex = existingId.lastIndexOf('#')
  const existingFragment = fragmentIndex >= 0 ? existingId.slice(fragmentIndex + 1) : ''

  if (existingFragment) {
    return `${annotationPageId}#${existingFragment}`
  }

  if (existingId && !/^https?:\/\//i.test(existingId) && !/^detektiiif:\/\//i.test(existingId)) {
    return `${annotationPageId}#${encodeURIComponent(existingId)}`
  }

  const seed = `${annotationPageId}\n${index}\n${JSON.stringify(annotation || {})}`

  return `${annotationPageId}#${v5(seed, FALLBACK_ANNOTATION_NAMESPACE)}`
}

function shouldKeepAnnotationId(id, annotationPageId) {
  return (
    id.startsWith(`${annotationPageId}#`) ||
    (
      /^https?:\/\//i.test(id) &&
      !id.startsWith(`${DETEKTIIIF_ANNOTATION_BASE_URL}/`) &&
      !id.startsWith(`${GITHUB_RAW_CONTENT_BASE_URL}/`)
    )
  )
}

function normalizeRemoteAnnotationItems(annotationPageId, items) {
  if (!Array.isArray(items)) {
    return []
  }

  return items.map((annotation, index) => {
    const annotationId = typeof annotation?.id === 'string' ? annotation.id.trim() : ''

    return {
      ...annotation,
      id: shouldKeepAnnotationId(annotationId, annotationPageId)
        ? annotationId
        : createAnnotationFallbackId(annotationPageId, annotation, index),
    }
  })
}

function createRepositoryAnnotationPage(
  config,
  workspace,
  canvasId,
  path,
  items,
  workspaceUri,
  pageIndex
) {
  const annotationPageId = getStableAnnotationPageUri(workspaceUri, canvasId)
  const pageId = pageIndex === 0
    ? annotationPageId
    : `${annotationPageId}/pages/${pageIndex + 1}`

  return {
    '@context': 'http://www.w3.org/ns/anno.jsonld',
    id: pageId,
    items: normalizeRemoteAnnotationItems(annotationPageId, items),
    partOf: {
      id: workspaceUri,
      label: { none: [workspace.name] },
      type: 'Collection',
    },
    seeAlso: [{
      format: 'application/ld+json',
      id: getRawContentUri(config, path),
      type: 'Dataset',
    }],
    target: canvasId,
    type: 'AnnotationPage',
  }
}

function collectRepositoryWorkspaceFilePaths(workspace) {
  if (!workspace || typeof workspace !== 'object') {
    return []
  }

  const paths = []

  if (workspace.itemsPath) {
    paths.push(workspace.itemsPath)
  }

  if (Array.isArray(workspace.itemFiles)) {
    workspace.itemFiles.forEach((file) => {
      if (file?.path) {
        paths.push(file.path)
      }
    })
  }

  if (Array.isArray(workspace.annotationIndexFiles)) {
    workspace.annotationIndexFiles.forEach((file) => {
      if (file?.path) {
        paths.push(file.path)
      }
    })
  }

  if (workspace.annotations && typeof workspace.annotations === 'object') {
    Object.values(workspace.annotations).forEach((annotation) => {
      if (annotation?.path) {
        paths.push(annotation.path)
      }
      if (Array.isArray(annotation?.pages)) {
        annotation.pages.forEach((page) => {
          if (page?.path) {
            paths.push(page.path)
          }
        })
      }
    })
  }

  return paths
}

function getRemovedRepositoryWorkspacePaths(previousWorkspace, nextPaths) {
  const retainedPaths = new Set(nextPaths)

  return collectRepositoryWorkspaceFilePaths(previousWorkspace)
    .filter((path) => !retainedPaths.has(path))
}

function getRepositoryWorkspaceName(config, workspace) {
  return workspace?.name || config.repo || 'Workspace'
}

function storageValuesEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function createRepositoryWorkspaceMetadata(config, options = {}) {
  const now = new Date().toISOString()
  const name = String(options.name || config.repo || 'Workspace').trim() || 'Workspace'

  return {
    annotationIndexFiles: [],
    annotationsUpdatedAt: now,
    generatedBy: 'detektIIIF',
    id: createStableWorkspaceUri(
      options.repositoryId ? `github-repository:${options.repositoryId}` : ''
    ),
    itemFiles: [],
    itemsUpdatedAt: now,
    name,
    repository: getRepositoryWorkspaceUri(config),
    type: GITHUB_REPOSITORY_WORKSPACE_TYPE,
    updatedAt: now,
    version: GITHUB_REPOSITORY_WORKSPACE_VERSION,
    workspaceId: GITHUB_REPOSITORY_WORKSPACE_ID,
  }
}

function buildRepositoryWorkspaceStorage(
  config,
  workspaces,
  activeWorkspaceId,
  model,
  previousSnapshot,
  repository,
  revisionId = v4()
) {
  const normalized = model.normalizeWorkspaces(workspaces)
  const activeId = model.normalizeActiveWorkspaceId(normalized, activeWorkspaceId)
  const workspace = normalized[activeId] || model.getActiveWorkspace(normalized, activeId)
  const previousWorkspace = previousSnapshot?.workspace || null
  const previousMetadata = previousSnapshot?.metadata || null
  const previousAnnotationMetadata = previousSnapshot?.annotationMetadata || {}
  const now = new Date().toISOString()
  const items = model.isPlainObject(workspace.items) ? workspace.items : {}
  const annotations = model.isPlainObject(workspace.annotations)
    ? workspace.annotations
    : {}
  const annotationMetadata = {}
  const files = []
  const repositoryWorkspaceUri = getRepositoryWorkspaceUri(config)
  const workspaceUri = getStableWorkspaceUri(previousMetadata, config, repository)

  let itemFiles
  if (
    previousWorkspace &&
    Array.isArray(previousMetadata?.itemFiles) &&
    storageValuesEqual(previousWorkspace.items, items)
  ) {
    itemFiles = previousMetadata.itemFiles
  } else {
    const itemEntries = Object.entries(items).sort(([left], [right]) => left.localeCompare(right))
    const itemChunks = splitValuesBySize(
      itemEntries,
      (entries) => Object.fromEntries(entries),
      'A collected IIIF resource'
    )
    itemFiles = itemChunks.map((entries, index) => {
      const path = getRepositoryItemsPartPath(revisionId, index)

      files.push({
        message: `detektIIIF: update items for ${getRepositoryWorkspaceName(config, workspace)}`,
        path,
        value: Object.fromEntries(entries),
      })

      return { itemCount: entries.length, path }
    })
  }

  Object.keys(annotations).sort().forEach((canvasId) => {
    const annotationItems = Array.isArray(annotations[canvasId]) ? annotations[canvasId] : []

    if (annotationItems.length === 0) {
      return
    }

    if (
      previousWorkspace &&
      previousAnnotationMetadata[canvasId] &&
      storageValuesEqual(previousWorkspace.annotations?.[canvasId] || [], annotationItems)
    ) {
      annotationMetadata[canvasId] = previousAnnotationMetadata[canvasId]
      return
    }

    const annotationChunks = splitValuesBySize(
      annotationItems,
      (chunkItems, pageIndex) => createRepositoryAnnotationPage(
        config,
        workspace,
        canvasId,
        getRepositoryAnnotationPartPath(revisionId, canvasId, pageIndex),
        chunkItems,
        workspaceUri,
        pageIndex
      ),
      `An annotation for canvas "${canvasId}"`
    )
    const pages = annotationChunks.map((chunkItems, pageIndex) => {
      const path = getRepositoryAnnotationPartPath(revisionId, canvasId, pageIndex)
      const annotationPage = createRepositoryAnnotationPage(
        config,
        workspace,
        canvasId,
        path,
        chunkItems,
        workspaceUri,
        pageIndex
      )

      files.push({
        message: `detektIIIF: update annotations for ${getRepositoryWorkspaceName(config, workspace)}`,
        path,
        value: annotationPage,
      })

      return {
        id: annotationPage.id,
        itemCount: annotationPage.items.length,
        path,
        source: getRawContentUri(config, path),
      }
    })

    annotationMetadata[canvasId] = {
      id: getStableAnnotationPageUri(workspaceUri, canvasId),
      itemCount: annotationItems.length,
      pages,
      updatedAt: workspace.annotationsUpdatedAt || workspace.updatedAt || now,
    }
  })

  let annotationIndexFiles
  if (
    Array.isArray(previousMetadata?.annotationIndexFiles) &&
    storageValuesEqual(previousAnnotationMetadata, annotationMetadata)
  ) {
    annotationIndexFiles = previousMetadata.annotationIndexFiles
  } else {
    const annotationIndexEntries = Object.entries(annotationMetadata)
    const annotationIndexChunks = splitValuesBySize(
      annotationIndexEntries,
      (entries) => Object.fromEntries(entries),
      'GitHub annotation index metadata'
    )
    annotationIndexFiles = annotationIndexChunks.map((entries, index) => {
      const path = getRepositoryAnnotationIndexPath(revisionId, index)

      files.push({
        message: `detektIIIF: update annotation index for ${getRepositoryWorkspaceName(config, workspace)}`,
        path,
        value: Object.fromEntries(entries),
      })

      return { canvasCount: entries.length, path }
    })
  }

  const workspaceMetadata = {
    annotationIndexFiles,
    annotationsUpdatedAt: workspace.annotationsUpdatedAt || workspace.updatedAt || now,
    generatedBy: 'detektIIIF',
    id: workspaceUri,
    itemFiles,
    itemsUpdatedAt: workspace.itemsUpdatedAt || workspace.updatedAt || now,
    name: getRepositoryWorkspaceName(config, workspace),
    repository: repositoryWorkspaceUri,
    revision: revisionId,
    type: GITHUB_REPOSITORY_WORKSPACE_TYPE,
    updatedAt: workspace.updatedAt || now,
    version: GITHUB_REPOSITORY_WORKSPACE_VERSION,
    workspaceId: workspace.id,
  }

  return {
    activeWorkspaceId: workspace.id,
    annotationMetadata,
    files,
    workspace,
    workspaceMetadata,
  }
}

async function readRequiredGitHubFile(config, path) {
  const file = await readGitHubFile(config, path)

  if (!file) {
    throw new Error(`GitHub workspace file is missing: ${path}`)
  }

  return file
}

async function loadRepositoryItems(config, metadata, model) {
  if (Array.isArray(metadata.itemFiles)) {
    const items = {}

    for (const fileMetadata of metadata.itemFiles) {
      if (!fileMetadata?.path) {
        continue
      }
      const file = await readRequiredGitHubFile(config, fileMetadata.path)
      if (!model.isPlainObject(file.value)) {
        throw new Error(`GitHub workspace item file is not a JSON object: ${fileMetadata.path}`)
      }
      Object.assign(items, file.value)
    }

    return items
  }

  const legacyFile = metadata.itemsPath
    ? await readRequiredGitHubFile(config, metadata.itemsPath)
    : null

  return model.isPlainObject(legacyFile?.value) ? legacyFile.value : {}
}

async function loadRepositoryAnnotationMetadata(config, metadata, model) {
  if (Array.isArray(metadata.annotationIndexFiles)) {
    const annotations = {}

    for (const fileMetadata of metadata.annotationIndexFiles) {
      if (!fileMetadata?.path) {
        continue
      }
      const file = await readRequiredGitHubFile(config, fileMetadata.path)
      if (!model.isPlainObject(file.value)) {
        throw new Error(`GitHub annotation index is not a JSON object: ${fileMetadata.path}`)
      }
      Object.assign(annotations, file.value)
    }

    return annotations
  }

  return model.isPlainObject(metadata.annotations) ? metadata.annotations : {}
}

async function loadRepositoryAnnotations(config, annotationMetadata, model) {
  const annotations = {}

  for (const canvasId of Object.keys(annotationMetadata)) {
    const metadata = annotationMetadata[canvasId]
    const pages = Array.isArray(metadata?.pages)
      ? metadata.pages
      : metadata?.path ? [{ path: metadata.path }] : []
    const items = []

    for (const pageMetadata of pages) {
      if (!pageMetadata?.path) {
        continue
      }
      const file = await readRequiredGitHubFile(config, pageMetadata.path)
      const annotationPage = model.isPlainObject(file.value) ? file.value : {}

      if (!Array.isArray(annotationPage.items)) {
        throw new Error(`GitHub AnnotationPage has no items array: ${pageMetadata.path}`)
      }
      items.push(...annotationPage.items)
    }

    annotations[canvasId] = items
  }

  return annotations
}

async function loadRepositoryWorkspaceSnapshot(config, model) {
  const workspaceFile = await readGitHubFile(config, getRepositoryWorkspacePath())
  const metadata = model.isPlainObject(workspaceFile?.value)
    ? workspaceFile.value
    : null

  if (metadata && !isDetektIIIFWorkspaceMetadata(metadata)) {
    throw new Error('The selected GitHub repository is not a detektIIIF workspace repository.')
  }

  if (!metadata) {
    const workspaces = model.normalizeWorkspaces({
      [model.DEFAULT_WORKSPACE_ID]: model.createWorkspace(
        model.DEFAULT_WORKSPACE_ID,
        config.repo || 'Workspace'
      ),
    })

    return {
      activeWorkspaceId: model.DEFAULT_WORKSPACE_ID,
      annotationMetadata: {},
      metadata: null,
      workspace: workspaces[model.DEFAULT_WORKSPACE_ID],
      workspaceFile: null,
      workspaces,
    }
  }

  const annotationMetadata = await loadRepositoryAnnotationMetadata(config, metadata, model)
  const [items, annotations] = await Promise.all([
    loadRepositoryItems(config, metadata, model),
    loadRepositoryAnnotations(config, annotationMetadata, model),
  ])

  const workspaceId = metadata.workspaceId || model.DEFAULT_WORKSPACE_ID

  const workspaces = model.normalizeWorkspaces({
    [workspaceId]: model.normalizeWorkspace({
      annotations,
      annotationsUpdatedAt: metadata.annotationsUpdatedAt || metadata.updatedAt,
      id: workspaceId,
      items,
      itemsUpdatedAt: metadata.itemsUpdatedAt || metadata.updatedAt,
      name: metadata.name || config.repo || workspaceId,
      updatedAt: metadata.updatedAt,
    }, workspaceId),
  })

  return {
    activeWorkspaceId: workspaceId,
    annotationMetadata,
    metadata,
    workspace: workspaces[workspaceId],
    workspaceFile,
    workspaces,
  }
}

async function mutateRepositoryWorkspaceState(config, model, mutator) {
  const maxAttempts = 3

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const snapshot = await loadRepositoryWorkspaceSnapshot(config, model)
    const current = {
      activeWorkspaceId: snapshot.activeWorkspaceId,
      workspaces: snapshot.workspaces,
    }
    const next = await mutator(current)

    if (!next) {
      return current
    }

    const {
      activeWorkspaceId,
      annotationMetadata,
      files,
      workspace,
      workspaceMetadata,
    } = buildRepositoryWorkspaceStorage(
      config,
      next.workspaces,
      next.activeWorkspaceId,
      model,
      snapshot,
      null
    )

    try {
      for (const file of files) {
        await writeGitHubFile(config, file.path, file.value, file.message, {
          expectedSha: null,
        })
      }

      await writeGitHubFile(
        config,
        getRepositoryWorkspacePath(),
        workspaceMetadata,
        'detektIIIF: update workspace',
        {
          existing: snapshot.workspaceFile,
          expectedSha: snapshot.workspaceFile?.sha || null,
        }
      )
    } catch (error) {
      if (isGitHubConflictError(error) && attempt + 1 < maxAttempts) {
        continue
      }

      throw error
    }

    const nextMetadataWithAnnotations = {
      ...workspaceMetadata,
      annotations: annotationMetadata,
    }
    const previousMetadataWithAnnotations = snapshot.metadata
      ? { ...snapshot.metadata, annotations: snapshot.annotationMetadata }
      : null
    const nextPaths = collectRepositoryWorkspaceFilePaths(nextMetadataWithAnnotations)

    for (const path of getRemovedRepositoryWorkspacePaths(previousMetadataWithAnnotations, nextPaths)) {
      try {
        await deleteGitHubFile(config, path, 'detektIIIF: remove obsolete workspace file')
      } catch (_error) {
        // The published root no longer references this file; failed cleanup only leaves an orphan.
      }
    }

    const workspaces = model.normalizeWorkspaces({
      [activeWorkspaceId]: {
        ...workspace,
        id: activeWorkspaceId,
        name: workspaceMetadata.name,
      },
    })

    return { activeWorkspaceId, workspaces }
  }

  throw new Error('The GitHub workspace changed repeatedly while saving. Please try again.')
}

async function resolveGitHubConfig(config) {
  const repository = await fetchGitHubJSON(config, buildRepoApiUrl(config), { method: 'GET' })

  return {
    config: {
      ...config,
      defaultBranch: repository.default_branch || 'main',
    },
    repository,
  }
}

function normalizeRepositoryVisibility(value) {
  return value === 'public' ? 'public' : 'private'
}

function createGitHubRepositorySummary(config, repository, extras = {}) {
  const owner = repository.owner?.login || config.owner
  const name = repository.name || config.repo

  return {
    defaultBranch: repository.default_branch || config.defaultBranch || 'main',
    fullName: repository.full_name || `${owner}/${name}`,
    htmlUrl: repository.html_url || `${GITHUB_WEB_BASE_URL}/${owner}/${name}`,
    name,
    owner,
    permissions: repository.permissions || {},
    private: Boolean(repository.private),
    ...extras,
  }
}

function createGitHubRepositoryAccess(config, repository) {
  const permissions = repository.permissions || {}
  const canAdmin = Boolean(permissions.admin)
  const canPush = Boolean(
    permissions.push ||
    permissions.maintain ||
    canAdmin
  )
  const canRead = Boolean(
    !repository.private ||
    permissions.pull ||
    permissions.triage ||
    canPush
  )

  return {
    canAdmin,
    canPush,
    canRead,
    defaultBranch: repository.default_branch || config.defaultBranch || 'main',
    htmlUrl: repository.html_url || `${GITHUB_WEB_BASE_URL}/${config.owner}/${config.repo}`,
    ownerType: repository.owner?.type || '',
    permissions,
    private: Boolean(repository.private),
    repository: repository.full_name || `${config.owner}/${config.repo}`,
  }
}

async function getGitHubWorkspaceRepositoryAccess(rawConfig) {
  const config = normalizeGitHubConfig(rawConfig)
  const { config: resolvedConfig, repository } = await resolveGitHubConfig(config)

  return createGitHubRepositoryAccess(resolvedConfig, repository)
}

async function openGitHubWorkspaceRepository(rawConfig) {
  const config = normalizeGitHubConfig(rawConfig)
  const { config: resolvedConfig, repository } = await resolveGitHubConfig(config)
  const workspaceFile = await readGitHubFile(resolvedConfig, getRepositoryWorkspacePath())

  if (!isDetektIIIFWorkspaceMetadata(workspaceFile?.value)) {
    throw new Error('The selected repository is not a detektIIIF workspace repository.')
  }

  const metadata = workspaceFile.value

  return {
    ...createGitHubRepositorySummary(resolvedConfig, repository),
    access: createGitHubRepositoryAccess(resolvedConfig, repository),
    id: repository.full_name || `${resolvedConfig.owner}/${resolvedConfig.repo}`,
    repo: repository.name || resolvedConfig.repo,
    updatedAt: metadata.updatedAt || repository.updated_at || '',
    workspaceId: metadata.workspaceId || GITHUB_REPOSITORY_WORKSPACE_ID,
    workspaceName: metadata.name || repository.name || resolvedConfig.repo,
  }
}

async function getAuthenticatedGitHubUser(rawConfig) {
  const config = normalizeGitHubTokenConfig(rawConfig)
  const user = await fetchGitHubJSON(config, buildAuthenticatedUserApiUrl(), { method: 'GET' })

  return {
    avatarUrl: user.avatar_url || '',
    login: user.login || '',
    url: user.html_url || '',
  }
}

async function ensureGitHubWorkspaceRegistryRepository(rawConfig) {
  const tokenConfig = normalizeGitHubTokenConfig(rawConfig)
  const user = await getAuthenticatedGitHubUser(tokenConfig)
  const config = {
    ...tokenConfig,
    defaultBranch: 'main',
    owner: user.login,
    repo: GITHUB_WORKSPACE_REGISTRY_REPOSITORY_NAME,
  }

  if (!config.owner) {
    throw new Error('Could not resolve the authenticated GitHub user for the workspace registry.')
  }

  try {
    const { config: resolvedConfig, repository } = await resolveGitHubConfig(config)

    if (repository.private !== true) {
      throw new Error(
        `The reserved GitHub repository "${GITHUB_WORKSPACE_REGISTRY_REPOSITORY_NAME}" must be private.`
      )
    }

    return {
      config: resolvedConfig,
      created: false,
      repository,
    }
  } catch (error) {
    if (error.status !== 404) {
      throw error
    }
  }

  const repository = await fetchGitHubJSON(
    config,
    buildAuthenticatedUserRepositoriesApiUrl(),
    {
      body: JSON.stringify({
        auto_init: true,
        description: 'detektIIIF workspace registry',
        name: GITHUB_WORKSPACE_REGISTRY_REPOSITORY_NAME,
        private: true,
      }),
      method: 'POST',
    }
  )

  return {
    config: {
      ...config,
      defaultBranch: repository.default_branch || 'main',
      owner: repository.owner?.login || config.owner,
      repo: repository.name || GITHUB_WORKSPACE_REGISTRY_REPOSITORY_NAME,
    },
    created: true,
    repository,
  }
}

async function readGitHubWorkspaceRegistry(rawConfig) {
  const { config } = await ensureGitHubWorkspaceRegistryRepository(rawConfig)
  const registryFile = await readGitHubFile(config, GITHUB_WORKSPACE_REGISTRY_PATH)

  if (registryFile?.value && !isDetektIIIFWorkspaceRegistry(registryFile.value)) {
    throw new Error(
      `${GITHUB_WORKSPACE_REGISTRY_REPOSITORY_NAME}/${GITHUB_WORKSPACE_REGISTRY_PATH} is not managed by detektIIIF.`
    )
  }

  const registry = registryFile?.value
    ? normalizeGitHubWorkspaceRegistry(registryFile.value)
    : createGitHubWorkspaceRegistry()

  if (!registryFile) {
    try {
      await writeGitHubFile(
        config,
        GITHUB_WORKSPACE_REGISTRY_PATH,
        registry,
        'detektIIIF: initialize workspace registry',
        { expectedSha: null }
      )
    } catch (error) {
      if (!isGitHubConflictError(error)) {
        throw error
      }

      const concurrentFile = await readGitHubFile(config, GITHUB_WORKSPACE_REGISTRY_PATH)
      if (!isDetektIIIFWorkspaceRegistry(concurrentFile?.value)) {
        throw error
      }

      return {
        config,
        registry: normalizeGitHubWorkspaceRegistry(concurrentFile.value),
      }
    }
  }

  return {
    config,
    registry,
  }
}

async function mutateGitHubWorkspaceRegistry(rawConfig, mutateEntries, message) {
  const { config } = await ensureGitHubWorkspaceRegistryRepository(rawConfig)
  const maxAttempts = 3

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const registryFile = await readGitHubFile(config, GITHUB_WORKSPACE_REGISTRY_PATH)

    if (registryFile?.value && !isDetektIIIFWorkspaceRegistry(registryFile.value)) {
      throw new Error(
        `${GITHUB_WORKSPACE_REGISTRY_REPOSITORY_NAME}/${GITHUB_WORKSPACE_REGISTRY_PATH} is not managed by detektIIIF.`
      )
    }

    const currentRegistry = registryFile?.value || createGitHubWorkspaceRegistry()
    const entries = mutateEntries(currentRegistry.workspaces || [])
    const registry = createGitHubWorkspaceRegistry(entries)

    try {
      await writeGitHubFile(
        config,
        GITHUB_WORKSPACE_REGISTRY_PATH,
        registry,
        message,
        {
          existing: registryFile,
          expectedSha: registryFile?.sha || null,
        }
      )

      return registry
    } catch (error) {
      if (isGitHubConflictError(error) && attempt + 1 < maxAttempts) {
        continue
      }

      throw error
    }
  }

  throw new Error('The GitHub workspace registry changed repeatedly. Please try again.')
}

async function addGitHubWorkspaceRepositoryToRegistry(rawConfig, repository) {
  const entry = normalizeGitHubWorkspaceRegistryEntry(repository)

  if (!entry) {
    return null
  }

  const entryKey = getGitHubWorkspaceRegistryEntryKey(entry)
  return mutateGitHubWorkspaceRegistry(
    rawConfig,
    (currentEntries) => {
      const entries = currentEntries.filter((item) => (
        getGitHubWorkspaceRegistryEntryKey(item) !== entryKey
      ))
      entries.push(entry)
      return entries
    },
    `detektIIIF: register workspace ${entry.owner}/${entry.repo}`
  )
}

async function removeGitHubWorkspaceRepositoryFromRegistry(rawConfig, repository) {
  const entry = normalizeGitHubWorkspaceRegistryEntry(repository)

  if (!entry) {
    return null
  }

  const entryKey = getGitHubWorkspaceRegistryEntryKey(entry)
  return mutateGitHubWorkspaceRegistry(
    rawConfig,
    (currentEntries) => currentEntries.filter((item) => (
      getGitHubWorkspaceRegistryEntryKey(item) !== entryKey
    )),
    `detektIIIF: unregister workspace ${entry.owner}/${entry.repo}`
  )
}

async function initializeGitHubWorkspaceRepository(rawConfig, options = {}) {
  const config = normalizeAuthenticatedGitHubConfig(rawConfig)
  const { config: resolvedConfig, repository } = await resolveGitHubConfig(config)
  const workspaceFile = await readGitHubFile(resolvedConfig, getRepositoryWorkspacePath())

  if (workspaceFile?.value && !isDetektIIIFWorkspaceMetadata(workspaceFile.value)) {
    throw new Error('This repository already has a workspace.json that is not managed by detektIIIF.')
  }

  const metadata = isDetektIIIFWorkspaceMetadata(workspaceFile?.value)
    ? {
      ...workspaceFile.value,
      id: getStableWorkspaceUri(workspaceFile.value, resolvedConfig, repository),
      name: options.name || workspaceFile.value.name || resolvedConfig.repo,
      repository: getRepositoryWorkspaceUri(resolvedConfig),
      updatedAt: workspaceFile.value.updatedAt || new Date().toISOString(),
      version: workspaceFile.value.version || 1,
    }
    : createRepositoryWorkspaceMetadata(resolvedConfig, {
      ...options,
      repositoryId: repository.id,
    })

  await writeGitHubFile(
    resolvedConfig,
    getRepositoryWorkspacePath(),
    metadata,
    'detektIIIF: initialize workspace',
    {
      existing: workspaceFile,
      expectedSha: workspaceFile?.sha || null,
    }
  )

  return metadata
}

async function createGitHubWorkspaceRepository(rawConfig, options = {}) {
  const config = normalizeAuthenticatedGitHubConfig(rawConfig)
  const user = await getAuthenticatedGitHubUser(config)
  const targetOwner = config.owner
  const targetIsAuthenticatedUser = user.login.toLowerCase() === targetOwner.toLowerCase()
  const visibility = normalizeRepositoryVisibility(options.visibility)
  const body = {
    auto_init: true,
    description: String(options.description || '').trim(),
    name: config.repo,
    private: visibility !== 'public',
  }

  if (!body.description) {
    delete body.description
  }

  const repository = await fetchGitHubJSON(
    config,
    targetIsAuthenticatedUser
      ? buildAuthenticatedUserRepositoriesApiUrl()
      : buildOrganizationRepositoriesApiUrl(targetOwner),
    {
      body: JSON.stringify(body),
      method: 'POST',
    }
  )

  const created = {
    ...createGitHubRepositorySummary(config, repository),
    created: true,
  }

  await initializeGitHubWorkspaceRepository({
    ...config,
    defaultBranch: created.defaultBranch,
    owner: created.owner,
    repo: created.name,
  }, {
    name: options.name || created.name,
  })

  return created
}

async function ensureGitHubWorkspaceRepository(rawConfig, options = {}) {
  const config = normalizeAuthenticatedGitHubConfig(rawConfig)

  try {
    const { config: resolvedConfig, repository } = await resolveGitHubConfig(config)

    await initializeGitHubWorkspaceRepository(resolvedConfig, {
      name: options.name || repository.name || config.repo,
    })

    return createGitHubRepositorySummary(resolvedConfig, repository, {
      created: false,
    })
  } catch (error) {
    if (error.status !== 404) {
      throw error
    }
  }

  return createGitHubWorkspaceRepository(config, options)
}

async function deleteGitHubWorkspaceRepository(rawConfig) {
  const config = normalizeAuthenticatedGitHubConfig(rawConfig)

  await fetchGitHubJSON(config, buildRepoApiUrl(config), { method: 'DELETE' })

  return {
    fullName: `${config.owner}/${config.repo}`,
    owner: config.owner,
    repo: config.repo,
  }
}

async function renameGitHubWorkspaceRepository(rawConfig, name) {
  const config = normalizeAuthenticatedGitHubConfig(rawConfig)
  const nextName = normalizeRepoPart(name, 'repository name').replace(/\.git$/i, '')
  const repository = await fetchGitHubJSON(config, buildRepoApiUrl(config), {
    body: JSON.stringify({ name: nextName }),
    method: 'PATCH',
  })
  const renamed = {
    defaultBranch: repository.default_branch || config.defaultBranch || 'main',
    fullName: repository.full_name || `${config.owner}/${nextName}`,
    htmlUrl: repository.html_url || `${GITHUB_WEB_BASE_URL}/${config.owner}/${nextName}`,
    name: repository.name || nextName,
    owner: repository.owner?.login || config.owner,
    private: Boolean(repository.private),
  }

  await initializeGitHubWorkspaceRepository({
    ...config,
    defaultBranch: renamed.defaultBranch,
    owner: renamed.owner,
    repo: renamed.name,
  }, {
    name: renamed.name,
  })

  return renamed
}

async function readRepositoryWorkspaceSummary(rawConfig, repository) {
  const owner = repository.owner?.login || repository.owner || ''
  const repo = repository.name || repository.repo || ''

  if (!owner || !repo) {
    return null
  }

  const config = {
    defaultBranch: repository.default_branch || repository.defaultBranch || 'main',
    owner,
    repo,
    token: normalizeRepoPart(rawConfig?.token, 'personal access token'),
  }
  const workspaceFile = await readGitHubFile(config, getRepositoryWorkspacePath())

  if (!isDetektIIIFWorkspaceMetadata(workspaceFile?.value)) {
    return null
  }

  const metadata = workspaceFile.value

  return {
    defaultBranch: config.defaultBranch,
    fullName: repository.full_name || `${owner}/${repo}`,
    htmlUrl: repository.html_url || `${GITHUB_WEB_BASE_URL}/${owner}/${repo}`,
    id: repository.full_name || `${owner}/${repo}`,
    name: metadata.name || repo,
    owner,
    permissions: repository.permissions || {},
    private: Boolean(repository.private),
    repo,
    updatedAt: metadata.updatedAt || repository.updated_at || '',
    workspaceId: metadata.workspaceId || GITHUB_REPOSITORY_WORKSPACE_ID,
  }
}

async function listGitHubWorkspaceRepositories(rawConfig) {
  const config = {
    token: normalizeRepoPart(rawConfig?.token, 'personal access token'),
  }
  const tokenFingerprint = getTokenFingerprint(config.token)

  if (gitHubWorkspaceRepositoryListPromises.has(tokenFingerprint)) {
    return gitHubWorkspaceRepositoryListPromises.get(tokenFingerprint)
  }

  const listPromise = (async () => {
    const cachedRepositories = await readGitHubWorkspaceRepositoryCache(config)

    if (cachedRepositories) {
      return cachedRepositories
    }

    const discoveryLock = await claimGitHubWorkspaceRepositoryDiscovery(config)

    if (!discoveryLock.claimed) {
      const discoveredRepositories = await waitForGitHubWorkspaceRepositoryDiscovery(config)

      if (discoveredRepositories) {
        return discoveredRepositories
      }
    }

    try {
      const repositories = await listGitHubWorkspaceRepositoriesFromRegistry(rawConfig)

      await writeGitHubWorkspaceRepositoryCache(config, repositories)

      return repositories
    } catch (error) {
      const staleRepositories = await readGitHubWorkspaceRepositoryCache(config, {
        allowPending: true,
        allowStale: true,
      })

      await writeGitHubWorkspaceRepositoryCache(config, staleRepositories || [])

      throw error
    }
  })()
    .finally(() => {
      gitHubWorkspaceRepositoryListPromises.delete(tokenFingerprint)
    })

  gitHubWorkspaceRepositoryListPromises.set(tokenFingerprint, listPromise)

  return listPromise
}

async function listGitHubWorkspaceRepositoriesFromRegistry(rawConfig) {
  const config = normalizeGitHubTokenConfig(rawConfig)
  const staleRepositories = await readGitHubWorkspaceRepositoryCache(config, {
    allowPending: true,
    allowStale: true,
  })

  try {
    const { registry } = await readGitHubWorkspaceRegistry(config)
    const summaries = []
    const registryEntries = registry.workspaces || []

    for (const repository of registryEntries) {
      try {
        const summary = await readRepositoryWorkspaceSummary(config, repository)

        if (summary) {
          summaries.push(summary)
        }
      } catch (error) {
        if (isGitHubRateLimitError(error)) {
          throw error
        }

        console.warn('Could not read registered detektIIIF GitHub workspace repository.', error)
      }
    }

    const configuredRepository = normalizeGitHubWorkspaceRegistryEntry(rawConfig)
    const configuredRepositoryKey = getGitHubWorkspaceRegistryEntryKey(configuredRepository)
    const isConfiguredRepositoryRegistered = registryEntries.some((repository) => (
      getGitHubWorkspaceRegistryEntryKey(repository) === configuredRepositoryKey
    ))

    if (configuredRepositoryKey && !isConfiguredRepositoryRegistered) {
      try {
        const summary = await readRepositoryWorkspaceSummary(config, configuredRepository)

        if (summary) {
          summaries.push(summary)
          await addGitHubWorkspaceRepositoryToRegistry(config, summary)
        }
      } catch (error) {
        if (isGitHubRateLimitError(error)) {
          throw error
        }

        console.warn('Could not migrate the selected GitHub workspace repository into the registry.', error)
      }
    }

    const sortedSummaries = sortGitHubWorkspaceRepositorySummaries(summaries)

    await writeGitHubWorkspaceRepositoryCache(config, sortedSummaries)

    return sortedSummaries
  } catch (error) {
    if (staleRepositories && isGitHubRateLimitError(error)) {
      console.warn('Using cached GitHub workspace repository list after rate limit response.', error)
      return staleRepositories
    }

    throw error
  }
}

function createGitHubWorkspaceStore(rawConfig, model) {
  const config = normalizeGitHubConfig(rawConfig)
  let resolvedConfigPromise = null

  function getResolvedConfig() {
    if (!resolvedConfigPromise) {
      resolvedConfigPromise = resolveGitHubConfig(config).then((result) => result.config)
    }

    return resolvedConfigPromise
  }

  return {
    async loadWorkspaceState() {
      const resolvedConfig = await getResolvedConfig()
      const snapshot = await loadRepositoryWorkspaceSnapshot(resolvedConfig, model)

      return {
        activeWorkspaceId: snapshot.activeWorkspaceId,
        workspaces: snapshot.workspaces,
      }
    },

    async mutateWorkspaceState(mutator) {
      const resolvedConfig = await getResolvedConfig()

      if (!resolvedConfig.token) {
        throw new Error('A GitHub personal access token is required to update this workspace.')
      }

      return mutateRepositoryWorkspaceState(resolvedConfig, model, mutator)
    },

    async setActiveWorkspace() {
      const resolvedConfig = await getResolvedConfig()
      const snapshot = await loadRepositoryWorkspaceSnapshot(resolvedConfig, model)

      return {
        activeWorkspaceId: snapshot.activeWorkspaceId,
        workspaces: snapshot.workspaces,
      }
    },
  }
}

async function testGitHubWorkspaceStorage(rawConfig) {
  const config = normalizeGitHubConfig(rawConfig)
  const { config: resolvedConfig, repository } = await resolveGitHubConfig(config)
  const workspaceFile = await readGitHubFile(resolvedConfig, getRepositoryWorkspacePath())
  const access = createGitHubRepositoryAccess(resolvedConfig, repository)

  return {
    ...access,
    defaultBranch: resolvedConfig.defaultBranch,
    hasRepositoryWorkspace: Boolean(workspaceFile),
  }
}

async function listGitHubWorkspaceCollaborators(rawConfig) {
  const config = normalizeAuthenticatedGitHubConfig(rawConfig)
  const collaborators = await fetchGitHubJSON(
    config,
    buildCollaboratorApiUrl(config),
    { method: 'GET' }
  )

  return Array.isArray(collaborators)
    ? collaborators.map((collaborator) => ({
      avatarUrl: collaborator.avatar_url || '',
      login: collaborator.login || '',
      permissions: collaborator.permissions || {},
      roleName: collaborator.role_name || '',
      url: collaborator.html_url || '',
    }))
    : []
}

async function addGitHubWorkspaceCollaborator(rawConfig, username, permission = 'push') {
  const config = normalizeAuthenticatedGitHubConfig(rawConfig)
  const normalizedUsername = normalizeRepoPart(username, 'GitHub username')
  const normalizedPermission = ['pull', 'triage', 'push', 'maintain', 'admin'].includes(permission)
    ? permission
    : 'push'

  return fetchGitHubJSON(
    config,
    buildCollaboratorApiUrl(config, normalizedUsername),
    {
      body: JSON.stringify({ permission: normalizedPermission }),
      method: 'PUT',
    }
  )
}

async function removeGitHubWorkspaceCollaborator(rawConfig, username) {
  const config = normalizeAuthenticatedGitHubConfig(rawConfig)
  const normalizedUsername = normalizeRepoPart(username, 'GitHub username')

  return fetchGitHubJSON(
    config,
    buildCollaboratorApiUrl(config, normalizedUsername),
    { method: 'DELETE' },
    true
  )
}

async function listGitHubWorkspaceInvitations(rawConfig) {
  const config = normalizeAuthenticatedGitHubConfig(rawConfig)
  const invitations = await fetchGitHubJSON(
    config,
    buildRepositoryInvitationsApiUrl(config),
    { method: 'GET' }
  )

  return Array.isArray(invitations)
    ? invitations.map((invitation) => ({
      createdAt: invitation.created_at || '',
      id: invitation.id,
      login: invitation.invitee?.login || '',
      permission: invitation.permissions || 'pull',
      url: invitation.html_url || '',
    }))
    : []
}

async function removeGitHubWorkspaceInvitation(rawConfig, invitationId) {
  const config = normalizeAuthenticatedGitHubConfig(rawConfig)
  const normalizedInvitationId = normalizeRepoPart(invitationId, 'invitation ID')

  return fetchGitHubJSON(
    config,
    buildRepositoryInvitationsApiUrl(config, normalizedInvitationId),
    { method: 'DELETE' },
    true
  )
}

async function updateGitHubWorkspaceRepositoryVisibility(rawConfig, visibility) {
  const config = normalizeAuthenticatedGitHubConfig(rawConfig)
  const repository = await fetchGitHubJSON(config, buildRepoApiUrl(config), {
    body: JSON.stringify({ private: normalizeRepositoryVisibility(visibility) !== 'public' }),
    method: 'PATCH',
  })

  return createGitHubRepositorySummary(config, repository)
}

export {
  addGitHubWorkspaceCollaborator,
  createGitHubWorkspaceStore,
  createGitHubWorkspaceRepository,
  deleteGitHubWorkspaceRepository,
  ensureGitHubWorkspaceRepository,
  initializeGitHubWorkspaceRepository,
  getGitHubAnnotationPageUri,
  getRawContentUri,
  getAuthenticatedGitHubUser,
  forgetGitHubWorkspaceRepository,
  getGitHubWorkspaceRepositoryAccess,
  listGitHubWorkspaceRepositories,
  listGitHubWorkspaceCollaborators,
  listGitHubWorkspaceInvitations,
  openGitHubWorkspaceRepository,
  rememberGitHubWorkspaceRepository,
  removeGitHubWorkspaceCollaborator,
  removeGitHubWorkspaceInvitation,
  renameGitHubWorkspaceRepository,
  testGitHubWorkspaceStorage,
  updateGitHubWorkspaceRepositoryVisibility,
}
