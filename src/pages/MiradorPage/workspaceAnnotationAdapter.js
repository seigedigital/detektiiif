import {
  getCanvasAnnotations,
  saveCanvasAnnotations,
  wasWorkspaceClearedAfter,
} from '../../shared/workspaces'
import { DEFAULT_ANNOTATION_USER_NAME } from '../../shared/annotationUser'
import {
  WORKSPACE_STORAGE_BACKENDS,
  hasConfiguredGitHubStorage,
} from '../../shared/storage/storageSettings'
import { getGitHubAnnotationPageUri } from '../../shared/storage/githubWorkspaceStore'

const ANNOTATION_SAVE_DEBOUNCE_MS = 750
const ANNOTATION_DRAFT_STORAGE_PREFIX = 'annotationDraft:'
const ANNOTATION_PERSISTENCE_EVENT = 'detektiiif:annotation-persistence'
const ANNOTATION_RETRY_DELAYS_MS = [500, 1500, 3000]
const DETEKTIIIF_ANNOTATION_BASE_URL = 'https://detektiiif.net/workspaces'
const annotationEntries = new Map()

function createDetektIIIFAnnotationPageId(workspaceId, canvasId) {
  return `${DETEKTIIIF_ANNOTATION_BASE_URL}/${encodeURIComponent(workspaceId)}/annotations/${encodeURIComponent(canvasId)}`
}

async function resolveAnnotationPageId(session, workspaceId, canvasId) {
  const settings = session.settings

  if (
    settings.backend === WORKSPACE_STORAGE_BACKENDS.GITHUB &&
    hasConfiguredGitHubStorage(settings)
  ) {
    return getGitHubAnnotationPageUri(settings.github, workspaceId, canvasId)
  }

  return createDetektIIIFAnnotationPageId(workspaceId, canvasId)
}

function createAnnotationIdSuffix() {
  const cryptoApi = globalThis.crypto

  return cryptoApi && typeof cryptoApi.randomUUID === 'function'
    ? cryptoApi.randomUUID()
    : `${Date.now()}-${Math.random()}`
}

async function getEntryAnnotationPageId(entry) {
  if (!entry.annotationPageIdPromise) {
    entry.annotationPageIdPromise = resolveAnnotationPageId(
      entry.session,
      entry.workspaceId,
      entry.canvasId
    )
      .then((annotationPageId) => {
        entry.annotationPageId = annotationPageId

        return annotationPageId
      })
      .catch((error) => {
        entry.annotationPageIdPromise = null
        throw error
      })
  }

  return entry.annotationPageIdPromise
}

async function createAnnotationId(entry) {
  const annotationPageId = await getEntryAnnotationPageId(entry)

  return `${annotationPageId}#${createAnnotationIdSuffix()}`
}

function getEntryKey(storageIdentity, workspaceId, canvasId) {
  return `${storageIdentity}\n${workspaceId}\n${canvasId}`
}

function getDraftStorageKey(entry) {
  return `${ANNOTATION_DRAFT_STORAGE_PREFIX}${encodeURIComponent(getEntryKey(
    entry.storageIdentity,
    entry.workspaceId,
    entry.canvasId
  ))}`
}

function getStorageError() {
  const lastError = chrome.runtime && chrome.runtime.lastError

  return lastError ? new Error(lastError.message) : null
}

function localStorageGet(key) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(key, (result) => {
      const error = getStorageError()
      if (error) {
        reject(error)
        return
      }

      resolve(result?.[key] || null)
    })
  })
}

function localStorageSet(key, value) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [key]: value }, () => {
      const error = getStorageError()
      if (error) {
        reject(error)
        return
      }

      resolve()
    })
  })
}

function localStorageRemove(key) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.remove(key, () => {
      const error = getStorageError()
      if (error) {
        reject(error)
        return
      }

      resolve()
    })
  })
}

function cloneValue(value) {
  if (value === null || typeof value !== 'object') {
    return value
  }

  if (typeof globalThis.structuredClone === 'function') {
    return globalThis.structuredClone(value)
  }

  return JSON.parse(JSON.stringify(value))
}

function cloneItems(items) {
  return Array.isArray(items) ? items.map(cloneValue) : []
}

function normalizeAnnotationUserName(user) {
  return String(user || '').trim() || DEFAULT_ANNOTATION_USER_NAME
}

function createTimestamp() {
  return new Date().toISOString()
}

function reportAnnotationPersistence(entry, status, details = {}) {
  window.dispatchEvent(new CustomEvent(ANNOTATION_PERSISTENCE_EVENT, {
    detail: {
      canvasId: entry.canvasId,
      status,
      storageIdentity: entry.storageIdentity,
      workspaceId: entry.workspaceId,
      ...details,
    },
  }))
}

function clearAnnotationRetry(entry) {
  if (entry.retryTimer) {
    window.clearTimeout(entry.retryTimer)
    entry.retryTimer = null
  }
}

function withCreatedAttribution(annotation, userName) {
  const timestamp = createTimestamp()
  const attributedUser = normalizeAnnotationUserName(userName)

  return {
    ...annotation,
    created: annotation.created || timestamp,
    creationDate: annotation.creationDate || timestamp,
    creator: annotation.creator || attributedUser,
    modified: annotation.modified || timestamp,
  }
}

function withUpdatedAttribution(previousAnnotation, annotation, userName) {
  const timestamp = createTimestamp()
  const attributedUser = normalizeAnnotationUserName(userName)
  const previous = previousAnnotation || {}

  return {
    ...annotation,
    created: annotation.created || previous.created || timestamp,
    creationDate: annotation.creationDate || previous.creationDate || timestamp,
    creator: annotation.creator || previous.creator || attributedUser,
    lastEditor: attributedUser,
    lastSavedDate: timestamp,
    modified: timestamp,
  }
}

async function createAnnotationPage(entry, items) {
  const annotationPageId = await getEntryAnnotationPageId(entry)

  return {
    id: annotationPageId,
    type: 'AnnotationPage',
    items: cloneItems(items),
  }
}

function getAnnotationEntry(session, workspaceId, canvasId) {
  const key = getEntryKey(session.identity, workspaceId, canvasId)

  if (!annotationEntries.has(key)) {
    annotationEntries.set(key, {
      annotationPageId: null,
      annotationPageIdPromise: null,
      baseItems: null,
      canvasId,
      disposed: false,
      dirty: false,
      items: null,
      lastMutationAt: null,
      loadPromise: null,
      operationPromise: Promise.resolve(),
      persistPromise: Promise.resolve(),
      persistTimer: null,
      retryAttempt: 0,
      retryTimer: null,
      session,
      storageIdentity: session.identity,
      workspaceId,
    })
  }

  return annotationEntries.get(key)
}

async function loadAnnotationItems(entry) {
  if (entry.disposed) {
    return []
  }

  if (entry.items) {
    return entry.items
  }

  if (!entry.loadPromise) {
    entry.loadPromise = Promise.all([
      getCanvasAnnotations(entry.workspaceId, entry.canvasId, { session: entry.session }),
      localStorageGet(getDraftStorageKey(entry)),
    ])
      .then(async ([items, draft]) => {
        const draftWasCleared = draft?.mutationTimestamp
          ? await wasWorkspaceClearedAfter(
            entry.storageIdentity,
            entry.workspaceId,
            draft.mutationTimestamp
          )
          : false

        if (draftWasCleared) {
          await localStorageRemove(getDraftStorageKey(entry))
        }

        if (!entry.items) {
          entry.baseItems = !draftWasCleared && Array.isArray(draft?.baseItems)
            ? cloneItems(draft.baseItems)
            : cloneItems(items)
          entry.items = !draftWasCleared && Array.isArray(draft?.items)
            ? cloneItems(draft.items)
            : cloneItems(items)
        }

        if (!draftWasCleared && Array.isArray(draft?.items) && draft.mutationTimestamp) {
          entry.lastMutationAt = draft.mutationTimestamp
          scheduleAnnotationPersistence(entry, draft.mutationTimestamp)
        }

        return entry.items
      })
  }

  return entry.loadPromise
}

async function flushAnnotationEntry(entry) {
  if (entry.disposed) {
    return Promise.resolve()
  }

  if (entry.operationPromise) {
    await entry.operationPromise
  }

  if (entry.disposed) {
    return Promise.resolve()
  }

  if (entry.persistTimer) {
    window.clearTimeout(entry.persistTimer)
    entry.persistTimer = null
  }
  clearAnnotationRetry(entry)

  if (!entry.dirty) {
    return entry.persistPromise
  }

  const items = cloneItems(entry.items)
  const baseItems = cloneItems(entry.baseItems)
  const mutationTimestamp = entry.lastMutationAt || new Date().toISOString()
  entry.dirty = false
  reportAnnotationPersistence(entry, 'saving')
  entry.persistPromise = entry.persistPromise
    .catch(() => {})
    .then(() => saveCanvasAnnotations(entry.workspaceId, entry.canvasId, items, {
      mutationTimestamp,
      baseAnnotations: baseItems,
      session: entry.session,
    }))
    .then(async (result) => {
      const key = getDraftStorageKey(entry)
      const draft = await localStorageGet(key)

      if (draft?.mutationTimestamp === mutationTimestamp) {
        await localStorageRemove(key)
      }

      if (entry.lastMutationAt === mutationTimestamp) {
        const savedWorkspace = result?.workspaces?.[entry.workspaceId]
        const savedItems = savedWorkspace?.annotations?.[entry.canvasId] || []
        entry.baseItems = cloneItems(savedItems)
        entry.items = cloneItems(savedItems)
      }

      entry.retryAttempt = 0
      reportAnnotationPersistence(entry, 'saved')

      return result
    })
    .catch((error) => {
      entry.dirty = true
      console.error('Could not persist workspace annotations.', error)
      const retryDelay = ANNOTATION_RETRY_DELAYS_MS[entry.retryAttempt]

      if (retryDelay !== undefined && !entry.disposed) {
        entry.retryAttempt += 1
        reportAnnotationPersistence(entry, 'retrying', {
          attempt: entry.retryAttempt,
          error: error.message,
          maxAttempts: ANNOTATION_RETRY_DELAYS_MS.length,
          retryDelay,
        })
        entry.retryTimer = window.setTimeout(() => {
          entry.retryTimer = null
          flushAnnotationEntry(entry).catch(() => {})
        }, retryDelay)
      } else {
        reportAnnotationPersistence(entry, 'error', { error: error.message })
      }
      throw error
    })

  return entry.persistPromise
}

function scheduleAnnotationPersistence(entry, mutationTimestamp = new Date().toISOString()) {
  if (entry.disposed) {
    return
  }

  entry.dirty = true
  entry.lastMutationAt = mutationTimestamp
  entry.retryAttempt = 0
  clearAnnotationRetry(entry)

  if (entry.persistTimer) {
    window.clearTimeout(entry.persistTimer)
  }

  entry.persistTimer = window.setTimeout(() => {
    entry.persistTimer = null
    flushAnnotationEntry(entry).catch(() => {})
  }, ANNOTATION_SAVE_DEBOUNCE_MS)
}

function enqueueAnnotationMutation(entry, mutateItems) {
  const operation = entry.operationPromise
    .catch(() => {})
    .then(async () => {
      const currentItems = await loadAnnotationItems(entry)

      if (entry.disposed) {
        return createAnnotationPage(entry, [])
      }

      const nextItems = cloneItems(mutateItems(cloneItems(currentItems)))

      if (entry.disposed) {
        return createAnnotationPage(entry, [])
      }

      entry.items = nextItems
      const mutationTimestamp = new Date().toISOString()
      entry.lastMutationAt = mutationTimestamp
      await localStorageSet(getDraftStorageKey(entry), {
        canvasId: entry.canvasId,
        baseItems: cloneItems(entry.baseItems),
        items: cloneItems(nextItems),
        mutationTimestamp,
        storageIdentity: entry.storageIdentity,
        workspaceId: entry.workspaceId,
      })
      scheduleAnnotationPersistence(entry, mutationTimestamp)

      return createAnnotationPage(entry, nextItems)
    })

  entry.operationPromise = operation

  return operation
}

function flushPendingAnnotationWrites() {
  return Promise.all(
    Array.from(annotationEntries.values()).map(flushAnnotationEntry)
  )
}

function retryPendingAnnotationWrites() {
  const pendingEntries = Array.from(annotationEntries.values())
    .filter((entry) => entry.dirty && !entry.disposed)

  pendingEntries.forEach((entry) => {
    entry.retryAttempt = 0
    clearAnnotationRetry(entry)
  })

  return Promise.all(pendingEntries.map(flushAnnotationEntry))
}

function clearCachedAnnotationEntries(workspaceId, storageIdentity) {
  Array.from(annotationEntries.entries()).forEach(([key, entry]) => {
    if (
      (!workspaceId || entry.workspaceId === workspaceId) &&
      (!storageIdentity || entry.storageIdentity === storageIdentity)
    ) {
      if (entry.persistTimer) {
        window.clearTimeout(entry.persistTimer)
        entry.persistTimer = null
      }
      clearAnnotationRetry(entry)

      entry.disposed = true
      entry.dirty = false
      entry.baseItems = []
      entry.items = []
      entry.lastMutationAt = null
      annotationEntries.delete(key)
      localStorageRemove(getDraftStorageKey(entry)).catch((error) => {
        console.warn('Could not remove cached annotation draft.', error)
      })
    }
  })
}

class WorkspaceAnnotationAdapter {
  constructor(
    workspaceId,
    canvasId,
    user = DEFAULT_ANNOTATION_USER_NAME,
    readOnly = false,
    session
  ) {
    if (!session) {
      throw new Error('WorkspaceAnnotationAdapter needs a bound storage session.')
    }

    this.workspaceId = workspaceId
    this.canvasId = canvasId
    this.user = normalizeAnnotationUserName(user)
    this.readOnly = Boolean(readOnly)
    this.entry = getAnnotationEntry(session, workspaceId, canvasId)
  }

  assertWritable() {
    if (this.readOnly) {
      throw new Error('This workspace is read-only.')
    }
  }

  getStorageAdapterUser() {
    return this.user
  }

  async all() {
    await this.entry.operationPromise
    const items = await loadAnnotationItems(this.entry)

    return createAnnotationPage(this.entry, items)
  }

  async create(annotation) {
    this.assertWritable()
    const nextAnnotation = withCreatedAttribution({
      ...annotation,
      id: await createAnnotationId(this.entry),
    }, this.user)

    return enqueueAnnotationMutation(this.entry, (items) => ([
      ...items,
      nextAnnotation,
    ]))
  }

  async update(annotation) {
    this.assertWritable()
    return enqueueAnnotationMutation(this.entry, (items) => {
      const index = items.findIndex((item) => item.id === annotation.id)

      if (index >= 0) {
        items.splice(index, 1, withUpdatedAttribution(items[index], annotation, this.user))
      } else {
        items.push(withCreatedAttribution(annotation, this.user))
      }

      return items
    })
  }

  async delete(annotationId) {
    this.assertWritable()
    return enqueueAnnotationMutation(this.entry, (items) => (
      items.filter((item) => item.id !== annotationId)
    ))
  }

  async get(annotationId) {
    const page = await this.all()

    return page.items.find((item) => item.id === annotationId) || null
  }
}

export {
  ANNOTATION_PERSISTENCE_EVENT,
  clearCachedAnnotationEntries,
  flushPendingAnnotationWrites,
  retryPendingAnnotationWrites,
}
export default WorkspaceAnnotationAdapter
