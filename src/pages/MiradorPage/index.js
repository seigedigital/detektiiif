/*global chrome*/
import Mirador from 'mirador';
import annotationPlugins from 'mirador-annotation-editor';
import 'mirador-annotation-editor/dist/index.css';

import {
  ANNOTATION_USER_SETTINGS_KEY,
  getAnnotationUserDisplayName,
  loadAnnotationUserSettings,
} from '../../shared/annotationUser'
import {
  DEFAULT_WORKSPACE_ID,
  WORKSPACE_CLEAR_SIGNAL_STORAGE_KEY,
  WORKSPACE_INDEX_STORAGE_KEY,
  createWorkspaceStorageSession,
  getActiveWorkspace,
} from '../../shared/workspaces'
import {
  getAuthenticatedGitHubUser,
  getGitHubWorkspaceRepositoryAccess,
} from '../../shared/storage/githubWorkspaceStore'
import {
  WORKSPACE_STORAGE_BACKENDS,
  WORKSPACE_STORAGE_SETTINGS_KEY,
  hasConfiguredGitHubStorage,
  hasGitHubToken,
} from '../../shared/storage/storageSettings'
import WorkspaceAnnotationAdapter, {
  ANNOTATION_PERSISTENCE_EVENT,
  clearCachedAnnotationEntries,
  flushPendingAnnotationWrites,
  retryPendingAnnotationWrites,
} from './workspaceAnnotationAdapter'
import './style.css'

let miradorInstance = null
let renderTimer = null
let renderGeneration = 0
let currentWorkspaceId = null
let currentStorageIdentity = null
let pageWorkspaceId = getRequestedWorkspaceId()
let pendingRenderShouldFlushAnnotations = true
let pendingClearAllAnnotationEntries = false
let deferredRenderOptions = null
const pendingAnnotationCacheClears = new Map()

function getRequestedWorkspaceId() {
  const params = new URLSearchParams(window.location.search)

  return params.get('workspace')
}

function getWorkspaceForPage(workspaces, activeWorkspaceId) {
  if (pageWorkspaceId && workspaces[pageWorkspaceId]) {
    return workspaces[pageWorkspaceId]
  }

  return getActiveWorkspace(workspaces, activeWorkspaceId)
}

function setPageWorkspaceId(workspaceId) {
  if (!workspaceId) {
    return
  }

  pageWorkspaceId = workspaceId

  const params = new URLSearchParams(window.location.search)
  params.set('workspace', workspaceId)

  const queryString = params.toString()
  const nextUrl = `${window.location.pathname}${queryString ? `?${queryString}` : ''}${window.location.hash}`

  window.history.replaceState(null, '', nextUrl)
}

function getManifestItems(workspace) {
  return Object.values(workspace.items || {})
    .filter((item) => item && item.url)
}

async function resolveAnnotationUserName(storageSettings) {
  const userSettings = await loadAnnotationUserSettings()
  const fallbackUserName = getAnnotationUserDisplayName(userSettings)

  try {
    if (
      storageSettings.backend === WORKSPACE_STORAGE_BACKENDS.GITHUB &&
      hasConfiguredGitHubStorage(storageSettings) &&
      hasGitHubToken(storageSettings)
    ) {
      const githubUser = await getAuthenticatedGitHubUser(storageSettings.github)

      return githubUser.login || fallbackUserName
    }
  } catch (error) {
    console.warn('Could not resolve annotation user from GitHub.', error)
  }

  return fallbackUserName
}

async function resolveWorkspaceReadOnly(storageSettings) {
  if (
    storageSettings.backend !== WORKSPACE_STORAGE_BACKENDS.GITHUB ||
    !hasConfiguredGitHubStorage(storageSettings)
  ) {
    return false
  }

  try {
    const access = await getGitHubWorkspaceRepositoryAccess(storageSettings.github)

    return !access.canPush
  } catch (error) {
    console.warn('Could not resolve GitHub workspace write access.', error)
    return true
  }
}

function buildMiradorConfig(workspace, annotationUserName, readOnly, storageSession) {
  const manifestItems = getManifestItems(workspace)
  const catalog = manifestItems.map((item) => ({
    manifestId: item.url,
    provider: item.label,
  }))
  const windows = manifestItems.slice(0, 4).map((item) => ({
    manifestId: item.url,
  }))
  const createAnnotationAdapter = (canvasId) => new WorkspaceAnnotationAdapter(
    workspace.id,
    canvasId,
    annotationUserName,
    readOnly,
    storageSession
  )

  window.detektIIIFCreateAnnotationAdapter = createAnnotationAdapter

  return {
    id: 'Mirador-Container',
    workspace: {
      isWorkspaceAddVisible: true,
    },
    windows,
    catalog,
    annotation: {
      adapter: createAnnotationAdapter,
      allowTargetShapesStyling: true,
      exportLocalStorageAnnotations: false,
      readonly: readOnly,
      tagsSuggestions: ['detektIIIF', workspace.name],
    },
    window: {
      allowFullscreen: true,
      forceDrawAnnotations: true,
      panels: {
        annotations: true,
        attribution: true,
        canvas: true,
        info: true,
        layers: true,
        search: true,
      },
      sideBarPanel: 'annotations',
    },
    theme: {
      palette: {
        primary: {
          main: '#404040',
        },
      },
    },
  }
}

function unmountMirador() {
  if (miradorInstance && typeof miradorInstance.unmount === 'function') {
    miradorInstance.unmount()
  }
  miradorInstance = null
}

function isCurrentRender(generation) {
  return generation === renderGeneration
}

function mergeRenderOptions(current = {}, next = {}) {
  const cacheClears = new Map()

  ;[
    ...(current.clearAnnotationWorkspaceIds || []),
    ...(next.clearAnnotationWorkspaceIds || []),
  ].forEach((entry) => {
    const key = `${entry.storageIdentity || ''}\n${entry.workspaceId || ''}`
    cacheClears.set(key, entry)
  })

  return {
    clearAllAnnotationEntries: Boolean(
      current.clearAllAnnotationEntries || next.clearAllAnnotationEntries
    ),
    clearAnnotationWorkspaceIds: Array.from(cacheClears.values()),
    flushAnnotations: current.flushAnnotations !== false && next.flushAnnotations !== false,
  }
}

function resumeDeferredRender() {
  if (!deferredRenderOptions) {
    return
  }

  const options = deferredRenderOptions
  deferredRenderOptions = null
  scheduleMiradorRender(options)
}

async function renderMirador(options = {}, generation = renderGeneration) {
  const {
    clearAllAnnotationEntries = false,
    clearAnnotationWorkspaceIds = [],
    flushAnnotations = true,
  } = options

  if (flushAnnotations) {
    try {
      await flushPendingAnnotationWrites()
    } catch (error) {
      if (isCurrentRender(generation)) {
        deferredRenderOptions = mergeRenderOptions(deferredRenderOptions, options)
      }
      throw error
    }
  }

  if (!isCurrentRender(generation)) {
    return
  }

  if (flushAnnotations) {
    deferredRenderOptions = null
  }

  if (clearAllAnnotationEntries) {
    clearCachedAnnotationEntries()
    clearAnnotationPersistenceStates()
  }
  clearAnnotationWorkspaceIds.forEach(({ storageIdentity, workspaceId }) => {
    clearCachedAnnotationEntries(workspaceId, storageIdentity)
    clearAnnotationPersistenceStates(workspaceId, storageIdentity)
  })

  const storageSession = await createWorkspaceStorageSession()
  const { workspaces, activeWorkspaceId } = await storageSession.loadWorkspaceState()

  if (!isCurrentRender(generation)) {
    return
  }

  const workspace = getWorkspaceForPage(workspaces, activeWorkspaceId)
  const container = document.getElementById('Mirador-Container')

  if (!container) {
    return
  }

  const [annotationUserName, readOnly] = await Promise.all([
    resolveAnnotationUserName(storageSession.settings),
    resolveWorkspaceReadOnly(storageSession.settings),
  ])

  if (!isCurrentRender(generation)) {
    return
  }

  unmountMirador()
  container.innerHTML = ''
  currentWorkspaceId = workspace.id || DEFAULT_WORKSPACE_ID
  currentStorageIdentity = storageSession.identity
  setPageWorkspaceId(currentWorkspaceId)
  container.dataset.workspaceId = currentWorkspaceId
  miradorInstance = Mirador.viewer(
    buildMiradorConfig(workspace, annotationUserName, readOnly, storageSession),
    annotationPlugins
  )
  window.detektIIIFMirador = miradorInstance
}

function scheduleMiradorRender(options = {}) {
  const generation = ++renderGeneration

  if (options.flushAnnotations === false) {
    pendingRenderShouldFlushAnnotations = false
  }

  if (options.clearAllAnnotationEntries) {
    pendingClearAllAnnotationEntries = true
  }

  const requestedCacheClears = [
    ...(options.clearAnnotationWorkspaceIds || []),
    ...(options.clearAnnotationWorkspaceId ? [{
      storageIdentity: options.storageIdentity || currentStorageIdentity,
      workspaceId: options.clearAnnotationWorkspaceId,
    }] : []),
  ]

  requestedCacheClears.forEach(({ storageIdentity, workspaceId }) => {
    const key = `${storageIdentity || ''}\n${workspaceId}`
    pendingAnnotationCacheClears.set(key, {
      storageIdentity,
      workspaceId,
    })
  })

  if (renderTimer) {
    window.clearTimeout(renderTimer)
  }

  renderTimer = window.setTimeout(() => {
    const renderOptions = {
      clearAllAnnotationEntries: pendingClearAllAnnotationEntries,
      clearAnnotationWorkspaceIds: Array.from(pendingAnnotationCacheClears.values()),
      flushAnnotations: pendingRenderShouldFlushAnnotations,
    }

    renderTimer = null
    pendingRenderShouldFlushAnnotations = true
    pendingClearAllAnnotationEntries = false
    pendingAnnotationCacheClears.clear()
    renderMirador(renderOptions, generation).catch(reportMiradorError)
  }, 100)
}

function reportMiradorError(error) {
  console.error('detektIIIF Mirador page error.', error)
}

function flushPendingAnnotations() {
  flushPendingAnnotationWrites().catch(reportMiradorError)
}

const annotationPersistenceStates = new Map()

function clearAnnotationPersistenceStates(workspaceId, storageIdentity) {
  Array.from(annotationPersistenceStates.entries()).forEach(([key, detail]) => {
    if (
      (!workspaceId || detail.workspaceId === workspaceId) &&
      (!storageIdentity || detail.storageIdentity === storageIdentity)
    ) {
      annotationPersistenceStates.delete(key)
    }
  })

  updateAnnotationPersistenceStatus(getMostImportantAnnotationPersistenceState() || {})
}

function getAnnotationPersistenceKey(detail) {
  return `${detail.storageIdentity || ''}\n${detail.workspaceId || ''}\n${detail.canvasId || ''}`
}

function getMostImportantAnnotationPersistenceState() {
  const priorities = { error: 4, retrying: 3, saving: 2, saved: 1 }

  return Array.from(annotationPersistenceStates.values())
    .sort((left, right) => (
      (priorities[right.status] || 0) - (priorities[left.status] || 0)
    ))[0] || null
}

function updateAnnotationPersistenceStatus(detail = {}) {
  const status = document.getElementById('Annotation-Save-Status')
  const message = document.getElementById('Annotation-Save-Message')
  const retryButton = document.getElementById('Annotation-Save-Retry')

  if (!status || !message || !retryButton) {
    return
  }

  retryButton.hidden = detail.status !== 'error'
  status.dataset.status = detail.status || ''
  status.setAttribute('role', detail.status === 'error' ? 'alert' : 'status')
  status.hidden = false

  if (detail.status === 'saving') {
    message.textContent = 'Saving annotations...'
  } else if (detail.status === 'retrying') {
    const seconds = Math.max(1, Math.ceil(Number(detail.retryDelay || 0) / 1000))
    message.textContent = `Save failed. Retrying in ${seconds}s (${detail.attempt}/${detail.maxAttempts}).`
  } else if (detail.status === 'error') {
    message.textContent = `Annotations could not be saved: ${detail.error || 'Unknown error'}`
  } else if (detail.status === 'saved') {
    message.textContent = 'Annotations saved.'
  } else {
    status.hidden = true
  }
}

window.addEventListener(ANNOTATION_PERSISTENCE_EVENT, (event) => {
  const detail = event.detail || {}
  const key = getAnnotationPersistenceKey(detail)

  annotationPersistenceStates.set(key, detail)
  updateAnnotationPersistenceStatus(getMostImportantAnnotationPersistenceState())

  if (detail.status === 'saved') {
    resumeDeferredRender()
    window.setTimeout(() => {
      if (annotationPersistenceStates.get(key) === detail) {
        annotationPersistenceStates.delete(key)
        updateAnnotationPersistenceStatus(getMostImportantAnnotationPersistenceState() || {})
      }
    }, 2000)
  }
})

document.getElementById('Annotation-Save-Retry')?.addEventListener('click', () => {
  retryPendingAnnotationWrites()
    .then(resumeDeferredRender)
    .catch(() => {})
})

function useActiveWorkspaceChange(change) {
  pageWorkspaceId = change?.newValue || null
  scheduleMiradorRender({ clearAnnotationWorkspaceId: pageWorkspaceId })
}

function getIndexChunkCount(workspace, type) {
  const count = Number(workspace?.[`${type}ChunkCount`])

  return Number.isFinite(count) && count > 0 ? count : 0
}

function getClearedCurrentWorkspaceId(oldIndex, newIndex) {
  if (!currentWorkspaceId) {
    return null
  }

  const oldWorkspace = oldIndex?.workspaces?.[currentWorkspaceId]
  const newWorkspace = newIndex?.workspaces?.[currentWorkspaceId]

  if (!oldWorkspace || !newWorkspace) {
    return null
  }

  const oldChunkCount = (
    getIndexChunkCount(oldWorkspace, 'items') +
    getIndexChunkCount(oldWorkspace, 'annotations')
  )
  const newChunkCount = (
    getIndexChunkCount(newWorkspace, 'items') +
    getIndexChunkCount(newWorkspace, 'annotations')
  )

  return oldChunkCount > 0 && newChunkCount === 0 ? currentWorkspaceId : null
}

function workspaceIndexRequiresRender(oldIndex, newIndex) {
  if (!currentWorkspaceId) {
    return true
  }

  const oldWorkspace = oldIndex?.workspaces?.[currentWorkspaceId]
  const newWorkspace = newIndex?.workspaces?.[currentWorkspaceId]

  if (!oldWorkspace || !newWorkspace) {
    return true
  }

  return (
    oldWorkspace.name !== newWorkspace.name ||
    oldWorkspace.itemsUpdatedAt !== newWorkspace.itemsUpdatedAt ||
    oldWorkspace.itemsChunkCount !== newWorkspace.itemsChunkCount
  )
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && (
    changes[ANNOTATION_USER_SETTINGS_KEY] ||
    changes[WORKSPACE_STORAGE_SETTINGS_KEY] ||
    changes[WORKSPACE_CLEAR_SIGNAL_STORAGE_KEY]
  )) {
    if (changes[WORKSPACE_CLEAR_SIGNAL_STORAGE_KEY]) {
      const workspaceId = changes[WORKSPACE_CLEAR_SIGNAL_STORAGE_KEY].newValue?.workspaceId
      const storageIdentity = changes[WORKSPACE_CLEAR_SIGNAL_STORAGE_KEY].newValue?.storageIdentity

      if (
        (!storageIdentity || !currentStorageIdentity || storageIdentity === currentStorageIdentity) &&
        (!currentWorkspaceId || currentWorkspaceId === workspaceId || pageWorkspaceId === workspaceId)
      ) {
        pageWorkspaceId = workspaceId || pageWorkspaceId
        scheduleMiradorRender({
          clearAnnotationWorkspaceId: workspaceId,
          flushAnnotations: false,
          storageIdentity,
        })
      }
      return
    }

    if (changes[WORKSPACE_STORAGE_SETTINGS_KEY]) {
      pageWorkspaceId = null
      scheduleMiradorRender({ clearAllAnnotationEntries: true })
      return
    }

    if (changes[ANNOTATION_USER_SETTINGS_KEY]) {
      scheduleMiradorRender()
      return
    }

    pageWorkspaceId = null
    scheduleMiradorRender()
    return
  }

  if (areaName !== 'sync') {
    return
  }

  if (changes.activeWorkspaceId) {
    useActiveWorkspaceChange(changes.activeWorkspaceId)
    return
  }

  if (changes[WORKSPACE_INDEX_STORAGE_KEY]) {
    const clearedWorkspaceId = getClearedCurrentWorkspaceId(
      changes[WORKSPACE_INDEX_STORAGE_KEY].oldValue,
      changes[WORKSPACE_INDEX_STORAGE_KEY].newValue
    )

    if (clearedWorkspaceId) {
      scheduleMiradorRender({
        clearAnnotationWorkspaceId: clearedWorkspaceId,
        flushAnnotations: false,
      })
      return
    }
  }

  if (
    changes.workspaces ||
    (
      changes[WORKSPACE_INDEX_STORAGE_KEY] &&
      workspaceIndexRequiresRender(
        changes[WORKSPACE_INDEX_STORAGE_KEY].oldValue,
        changes[WORKSPACE_INDEX_STORAGE_KEY].newValue
      )
    )
  ) {
    scheduleMiradorRender()
  }
})

window.detektIIIFFlushAnnotationWrites = flushPendingAnnotationWrites
window.addEventListener('pagehide', flushPendingAnnotations)
window.addEventListener('beforeunload', flushPendingAnnotations)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    flushPendingAnnotations()
  }
})

renderGeneration += 1
renderMirador({}, renderGeneration).catch(reportMiradorError)
