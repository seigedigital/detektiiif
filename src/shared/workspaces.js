import { createGitHubWorkspaceStore } from './storage/githubWorkspaceStore';
import {
  WORKSPACE_STORAGE_BACKENDS,
  hasConfiguredGitHubStorage,
  loadWorkspaceStorageSettings,
} from './storage/storageSettings';

const WORKSPACES_STORAGE_KEY = 'workspaces';
const WORKSPACE_INDEX_STORAGE_KEY = 'workspaceIndex';
const ACTIVE_WORKSPACE_STORAGE_KEY = 'activeWorkspaceId';
const WORKSPACE_CLEAR_SIGNAL_STORAGE_KEY = 'workspaceClearSignal';
const DEFAULT_WORKSPACE_ID = 'default';
const LEGACY_BASKET_STORAGE_KEY = 'basket';
const WORKSPACE_STORAGE_VERSION = 2;
const WORKSPACE_CHUNK_SIZE_BYTES = 6000;
const WORKSPACE_CHUNK_TYPES = ['items', 'annotations'];
const BROWSER_SYNC_WORKSPACE_LOCK = 'detektiiif:browser-sync-workspaces';
const textEncoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
const workspaceMutationQueues = new Map();
let browserSyncLockQueue = Promise.resolve();

function getWorkspaceStorage() {
  return chrome.storage.sync;
}

function getStorageError() {
  const lastError = chrome.runtime && chrome.runtime.lastError;

  return lastError ? new Error(lastError.message) : null;
}

function storageGet(keys, area = getWorkspaceStorage()) {
  return new Promise((resolve, reject) => {
    area.get(keys, (result) => {
      const error = getStorageError();
      if (error) {
        reject(error);
        return;
      }

      resolve(result || {});
    });
  });
}

function storageSet(data, area = getWorkspaceStorage()) {
  return new Promise((resolve, reject) => {
    area.set(data, () => {
      const error = getStorageError();
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function storageRemove(keys, area = getWorkspaceStorage()) {
  return new Promise((resolve, reject) => {
    area.remove(keys, () => {
      const error = getStorageError();
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function createWorkspace(id, name, items = {}, annotations = {}) {
  const timestamp = new Date().toISOString();

  return {
    id,
    name,
    items: isPlainObject(items) ? items : {},
    annotations: normalizeAnnotationSets(annotations),
    updatedAt: timestamp,
    itemsUpdatedAt: timestamp,
    annotationsUpdatedAt: timestamp,
  };
}

function createDefaultWorkspace(items = {}) {
  return createWorkspace(DEFAULT_WORKSPACE_ID, 'default', items);
}

function normalizeAnnotationSets(annotations) {
  if (!isPlainObject(annotations)) {
    return {};
  }

  return Object.keys(annotations).reduce((normalized, canvasId) => {
    const items = annotations[canvasId];

    if (Array.isArray(items) && items.length > 0) {
      normalized[canvasId] = items;
    }

    return normalized;
  }, {});
}

function getAnnotationKey(annotation, index) {
  return annotation?.id || annotation?.['@id'] || `__index_${index}`;
}

function annotationsEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function mergeCanvasAnnotations(remoteAnnotations, baseAnnotations, localAnnotations) {
  if (!Array.isArray(baseAnnotations)) {
    return Array.isArray(localAnnotations) ? localAnnotations : [];
  }

  const remote = Array.isArray(remoteAnnotations) ? remoteAnnotations : [];
  const local = Array.isArray(localAnnotations) ? localAnnotations : [];
  const baseByKey = new Map(baseAnnotations.map((annotation, index) => (
    [getAnnotationKey(annotation, index), annotation]
  )));
  const localByKey = new Map(local.map((annotation, index) => (
    [getAnnotationKey(annotation, index), annotation]
  )));
  const mergedByKey = new Map(remote.map((annotation, index) => (
    [getAnnotationKey(annotation, index), annotation]
  )));

  baseByKey.forEach((baseAnnotation, key) => {
    if (!localByKey.has(key)) {
      mergedByKey.delete(key);
    }
  });

  localByKey.forEach((localAnnotation, key) => {
    const baseAnnotation = baseByKey.get(key);
    if (!baseAnnotation || !annotationsEqual(baseAnnotation, localAnnotation)) {
      mergedByKey.set(key, localAnnotation);
    }
  });

  return Array.from(mergedByKey.values());
}

function normalizeWorkspace(workspace, id) {
  if (!isPlainObject(workspace)) {
    return createWorkspace(id, id === DEFAULT_WORKSPACE_ID ? 'default' : id);
  }

  const updatedAt = workspace.updatedAt || new Date().toISOString();

  return {
    id: workspace.id || id,
    name: workspace.name || (id === DEFAULT_WORKSPACE_ID ? 'default' : id),
    items: isPlainObject(workspace.items) ? workspace.items : {},
    annotations: normalizeAnnotationSets(workspace.annotations),
    updatedAt,
    itemsUpdatedAt: workspace.itemsUpdatedAt || updatedAt,
    annotationsUpdatedAt: workspace.annotationsUpdatedAt || updatedAt,
  };
}

function normalizeWorkspaces(workspaces, legacyItems = {}) {
  const normalized = {};

  if (isPlainObject(workspaces)) {
    Object.keys(workspaces).forEach((id) => {
      normalized[id] = normalizeWorkspace(workspaces[id], id);
    });
  }

  if (!normalized[DEFAULT_WORKSPACE_ID]) {
    normalized[DEFAULT_WORKSPACE_ID] = createDefaultWorkspace(legacyItems);
  }

  return normalized;
}

function getExistingWorkspaceIds(workspaces) {
  return Object.keys(workspaces || {});
}

function normalizeActiveWorkspaceId(workspaces, activeWorkspaceId) {
  if (activeWorkspaceId && workspaces[activeWorkspaceId]) {
    return activeWorkspaceId;
  }

  return DEFAULT_WORKSPACE_ID;
}

function slugifyWorkspaceName(name) {
  const slug = String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug || 'workspace';
}

function buildWorkspaceId(name, workspaces) {
  const base = slugifyWorkspaceName(name);
  const existingIds = new Set(getExistingWorkspaceIds(workspaces));

  if (!existingIds.has(base)) {
    return base;
  }

  let counter = 2;
  while (existingIds.has(`${base}-${counter}`)) {
    counter += 1;
  }

  return `${base}-${counter}`;
}

function getByteLength(value) {
  if (textEncoder) {
    return textEncoder.encode(value).length;
  }

  return unescape(encodeURIComponent(value)).length;
}

function chunkString(value) {
  const chunks = [];
  let currentChunk = '';
  let currentChunkSize = 0;

  for (const char of value) {
    const charSize = getByteLength(char);

    if (currentChunk && currentChunkSize + charSize > WORKSPACE_CHUNK_SIZE_BYTES) {
      chunks.push(currentChunk);
      currentChunk = char;
      currentChunkSize = charSize;
    } else {
      currentChunk += char;
      currentChunkSize += charSize;
    }
  }

  if (currentChunk || value === '') {
    chunks.push(currentChunk);
  }

  return chunks;
}

function hasObjectEntries(value) {
  return isPlainObject(value) && Object.keys(value).length > 0;
}

function parseStorageTimestamp(value) {
  const timestamp = Date.parse(value);

  return Number.isFinite(timestamp) ? timestamp : null;
}

function getClearSignalKey(storageIdentity, workspaceId) {
  return `${storageIdentity}\n${workspaceId}`;
}

function normalizeClearSignals(value) {
  if (!isPlainObject(value)) {
    return {};
  }

  if (value.workspaceId && value.updatedAt) {
    return {
      [getClearSignalKey('browser-sync', value.workspaceId)]: value.updatedAt,
    };
  }

  return isPlainObject(value.signals) ? value.signals : value;
}

async function wasWorkspaceClearedAfter(storageIdentity, workspaceId, timestamp) {
  const mutationTimestamp = parseStorageTimestamp(timestamp);

  if (mutationTimestamp === null) {
    return false;
  }

  const data = await storageGet(WORKSPACE_CLEAR_SIGNAL_STORAGE_KEY, chrome.storage.local);
  const clearSignals = normalizeClearSignals(data[WORKSPACE_CLEAR_SIGNAL_STORAGE_KEY]);
  const clearTimestamp = parseStorageTimestamp(
    clearSignals[getClearSignalKey(storageIdentity, workspaceId)]
  );

  return (
    clearTimestamp !== null &&
    clearTimestamp >= mutationTimestamp
  );
}

function workspaceChunkKey(workspaceId, type, index) {
  return `workspace:${encodeURIComponent(workspaceId)}:${type}:${index}`;
}

function getChunkCount(metadata, type) {
  const count = Number(metadata?.[`${type}ChunkCount`]);

  return Number.isFinite(count) && count > 0 ? count : 0;
}

function getWorkspaceChunkKeys(metadata) {
  const keys = [];

  WORKSPACE_CHUNK_TYPES.forEach((type) => {
    for (let index = 0; index < getChunkCount(metadata, type); index += 1) {
      keys.push(workspaceChunkKey(metadata.id, type, index));
    }
  });

  return keys;
}

function getWorkspaceIndexChunkKeys(index) {
  if (!isPlainObject(index?.workspaces)) {
    return [];
  }

  return Object.values(index.workspaces)
    .filter(isPlainObject)
    .flatMap(getWorkspaceChunkKeys);
}

function parseChunkedJSON(chunks, fallback, description) {
  const value = chunks.join('');

  if (!value) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(value);

    if (!isPlainObject(parsed)) {
      throw new Error('Expected a JSON object.');
    }

    return parsed;
  } catch (error) {
    throw new Error(`Could not read ${description || 'chunked workspace data'}: ${error.message}`);
  }
}

function buildWorkspaceMetadata(workspace, itemsChunkCount, annotationsChunkCount) {
  return {
    id: workspace.id,
    name: workspace.name,
    updatedAt: workspace.updatedAt,
    itemsUpdatedAt: workspace.itemsUpdatedAt,
    annotationsUpdatedAt: workspace.annotationsUpdatedAt,
    itemsChunkCount,
    annotationsChunkCount,
  };
}

function buildChunkedWorkspaceStorage(workspaces) {
  const index = {
    version: WORKSPACE_STORAGE_VERSION,
    workspaces: {},
  };
  const chunks = {};

  Object.keys(workspaces).forEach((workspaceId) => {
    const workspace = workspaces[workspaceId];
    const items = hasObjectEntries(workspace.items) ? workspace.items : {};
    const annotations = normalizeAnnotationSets(workspace.annotations);
    const itemsChunks = hasObjectEntries(items) ? chunkString(JSON.stringify(items)) : [];
    const annotationsChunks = hasObjectEntries(annotations)
      ? chunkString(JSON.stringify(annotations))
      : [];

    itemsChunks.forEach((chunk, index) => {
      chunks[workspaceChunkKey(workspaceId, 'items', index)] = chunk;
    });
    annotationsChunks.forEach((chunk, index) => {
      chunks[workspaceChunkKey(workspaceId, 'annotations', index)] = chunk;
    });

    index.workspaces[workspaceId] = buildWorkspaceMetadata(
      workspace,
      itemsChunks.length,
      annotationsChunks.length
    );
  });

  return { chunks, index };
}

async function loadChunkedWorkspaces(index) {
  const metadataById = isPlainObject(index?.workspaces) ? index.workspaces : {};
  const chunkKeys = getWorkspaceIndexChunkKeys(index);
  const chunkData = chunkKeys.length > 0 ? await storageGet(chunkKeys) : {};
  const workspaces = {};

  Object.keys(metadataById).forEach((workspaceId) => {
    const metadata = metadataById[workspaceId];
    const itemsChunks = [];
    const annotationsChunks = [];

    for (let index = 0; index < getChunkCount(metadata, 'items'); index += 1) {
      const key = workspaceChunkKey(workspaceId, 'items', index);
      if (typeof chunkData[key] !== 'string') {
        throw new Error(`Workspace "${workspaceId}" is missing item chunk ${index + 1}.`);
      }
      itemsChunks.push(chunkData[key]);
    }

    for (let index = 0; index < getChunkCount(metadata, 'annotations'); index += 1) {
      const key = workspaceChunkKey(workspaceId, 'annotations', index);
      if (typeof chunkData[key] !== 'string') {
        throw new Error(`Workspace "${workspaceId}" is missing annotation chunk ${index + 1}.`);
      }
      annotationsChunks.push(chunkData[key]);
    }

    workspaces[workspaceId] = normalizeWorkspace({
      ...metadata,
      annotations: parseChunkedJSON(
        annotationsChunks,
        {},
        `annotations for workspace "${workspaceId}"`
      ),
      items: parseChunkedJSON(itemsChunks, {}, `items for workspace "${workspaceId}"`),
    }, workspaceId);
  });

  return normalizeWorkspaces(workspaces);
}

function mergeLegacyItems(workspaces, legacyItems) {
  if (Object.keys(legacyItems).length === 0) {
    return workspaces;
  }

  const timestamp = new Date().toISOString();

  return {
    ...workspaces,
    [DEFAULT_WORKSPACE_ID]: {
      ...workspaces[DEFAULT_WORKSPACE_ID],
      items: {
        ...legacyItems,
        ...(workspaces[DEFAULT_WORKSPACE_ID].items || {}),
      },
      itemsUpdatedAt: timestamp,
      updatedAt: timestamp,
    },
  };
}

function getObsoleteChunkKeys(previousIndex, nextIndex) {
  const nextKeys = new Set(getWorkspaceIndexChunkKeys(nextIndex));

  return getWorkspaceIndexChunkKeys(previousIndex)
    .filter((key) => !nextKeys.has(key));
}

function getLegacyStorageKeys(data) {
  return [
    WORKSPACES_STORAGE_KEY,
    LEGACY_BASKET_STORAGE_KEY,
  ].filter((key) => data[key] !== undefined);
}

async function loadBrowserSyncWorkspaceState() {
  const data = await storageGet([
    WORKSPACE_INDEX_STORAGE_KEY,
    WORKSPACES_STORAGE_KEY,
    ACTIVE_WORKSPACE_STORAGE_KEY,
    LEGACY_BASKET_STORAGE_KEY,
  ]);
  const legacyItems = isPlainObject(data[LEGACY_BASKET_STORAGE_KEY])
    ? data[LEGACY_BASKET_STORAGE_KEY]
    : {};
  const hasChunkedWorkspaces = isPlainObject(data[WORKSPACE_INDEX_STORAGE_KEY]?.workspaces);
  const hasLegacyWorkspaceState = isPlainObject(data[WORKSPACES_STORAGE_KEY]);
  let workspaces = hasChunkedWorkspaces
    ? await loadChunkedWorkspaces(data[WORKSPACE_INDEX_STORAGE_KEY])
    : normalizeWorkspaces(data[WORKSPACES_STORAGE_KEY], legacyItems);

  workspaces = mergeLegacyItems(workspaces, legacyItems);

  const activeWorkspaceId = normalizeActiveWorkspaceId(
    workspaces,
    data[ACTIVE_WORKSPACE_STORAGE_KEY]
  );

  if (!hasChunkedWorkspaces || hasLegacyWorkspaceState || Object.keys(legacyItems).length > 0) {
    await saveBrowserSyncWorkspaceState(workspaces, activeWorkspaceId);
  }

  return { workspaces, activeWorkspaceId };
}

async function saveBrowserSyncWorkspaceState(workspaces, activeWorkspaceId) {
  const normalized = normalizeWorkspaces(workspaces);
  const activeId = normalizeActiveWorkspaceId(normalized, activeWorkspaceId);
  const previous = await storageGet([
    WORKSPACE_INDEX_STORAGE_KEY,
    WORKSPACES_STORAGE_KEY,
    LEGACY_BASKET_STORAGE_KEY,
  ]);
  const previousIndex = previous[WORKSPACE_INDEX_STORAGE_KEY];
  const { chunks, index } = buildChunkedWorkspaceStorage(normalized);
  const keysToRemove = [
    ...getObsoleteChunkKeys(previousIndex, index),
    ...getLegacyStorageKeys(previous),
  ];

  await storageSet({
    ...chunks,
    [WORKSPACE_INDEX_STORAGE_KEY]: index,
    [ACTIVE_WORKSPACE_STORAGE_KEY]: activeId,
  });

  if (keysToRemove.length > 0) {
    await storageRemove(keysToRemove);
  }

  return { workspaces: normalized, activeWorkspaceId: activeId };
}

function getWorkspaceModel() {
  return {
    DEFAULT_WORKSPACE_ID,
    createDefaultWorkspace,
    createWorkspace,
    getActiveWorkspace,
    isPlainObject,
    normalizeActiveWorkspaceId,
    normalizeWorkspace,
    normalizeWorkspaces,
  };
}

function runWithBrowserSyncWorkspaceLock(operation) {
  if (globalThis.navigator?.locks?.request) {
    return globalThis.navigator.locks.request(BROWSER_SYNC_WORKSPACE_LOCK, operation);
  }

  const next = browserSyncLockQueue.catch(() => {}).then(operation);
  browserSyncLockQueue = next;

  return next;
}

const browserSyncWorkspaceStore = {
  loadWorkspaceState: loadBrowserSyncWorkspaceState,
  mutateWorkspaceState(mutator) {
    const mutate = async () => {
      const current = await loadBrowserSyncWorkspaceState();
      const next = await mutator(current);

      if (!next) {
        return current;
      }

      return saveBrowserSyncWorkspaceState(next.workspaces, next.activeWorkspaceId);
    };

    return runWithBrowserSyncWorkspaceLock(mutate);
  },
  async setActiveWorkspace(activeWorkspaceId) {
    return runWithBrowserSyncWorkspaceLock(async () => {
      const { workspaces } = await loadBrowserSyncWorkspaceState();
      const activeId = normalizeActiveWorkspaceId(workspaces, activeWorkspaceId);

      await storageSet({ [ACTIVE_WORKSPACE_STORAGE_KEY]: activeId });

      return { activeWorkspaceId: activeId, workspaces };
    });
  },
};

const unselectedGitHubWorkspaceStore = {
  async loadWorkspaceState() {
    return {
      activeWorkspaceId: DEFAULT_WORKSPACE_ID,
      workspaces: {
        [DEFAULT_WORKSPACE_ID]: createWorkspace(
          DEFAULT_WORKSPACE_ID,
          'Select a GitHub workspace'
        ),
      },
    };
  },
  async mutateWorkspaceState() {
    throw new Error('Select or create a GitHub workspace repository first.');
  },
  async setActiveWorkspace() {
    return this.loadWorkspaceState();
  },
};

function getWorkspaceStorageIdentity(settings) {
  if (
    settings.backend === WORKSPACE_STORAGE_BACKENDS.GITHUB &&
    hasConfiguredGitHubStorage(settings)
  ) {
    return `github:${settings.github.owner.toLowerCase()}/${settings.github.repo.toLowerCase()}`;
  }

  return settings.backend === WORKSPACE_STORAGE_BACKENDS.GITHUB
    ? 'github:unselected'
    : 'browser-sync';
}

function createWorkspaceStore(settings) {
  if (settings.backend === WORKSPACE_STORAGE_BACKENDS.GITHUB) {
    if (hasConfiguredGitHubStorage(settings)) {
      return createGitHubWorkspaceStore(settings.github, getWorkspaceModel());
    }

    return unselectedGitHubWorkspaceStore;
  }

  return browserSyncWorkspaceStore;
}

async function createWorkspaceStorageSession(providedSettings) {
  const settings = providedSettings || await loadWorkspaceStorageSettings();
  const store = createWorkspaceStore(settings);

  return {
    identity: getWorkspaceStorageIdentity(settings),
    settings,
    loadWorkspaceState: () => store.loadWorkspaceState(),
    mutateWorkspaceState: (mutator) => store.mutateWorkspaceState(mutator),
    setActiveWorkspace: (activeWorkspaceId) => store.setActiveWorkspace(activeWorkspaceId),
  };
}

async function getWorkspaceStore() {
  const session = await createWorkspaceStorageSession();

  return session;
}

async function loadWorkspaceState(options = {}) {
  const session = options.session || await getWorkspaceStore();

  return session.loadWorkspaceState();
}

async function mutateWorkspaceState(mutator, options = {}) {
  const session = options.session || await createWorkspaceStorageSession();
  const previous = workspaceMutationQueues.get(session.identity) || Promise.resolve();
  const operation = previous
    .catch(() => {})
    .then(() => session.mutateWorkspaceState((current) => mutator(current, session)));

  workspaceMutationQueues.set(session.identity, operation);
  operation.finally(() => {
    if (workspaceMutationQueues.get(session.identity) === operation) {
      workspaceMutationQueues.delete(session.identity);
    }
  }).catch(() => {});

  return operation;
}

function getActiveWorkspace(workspaces, activeWorkspaceId) {
  const activeId = normalizeActiveWorkspaceId(workspaces, activeWorkspaceId);

  return workspaces[activeId] || createDefaultWorkspace();
}

async function setActiveWorkspace(activeWorkspaceId) {
  const session = await createWorkspaceStorageSession();

  return session.setActiveWorkspace(activeWorkspaceId);
}

async function addWorkspace(name) {
  const trimmedName = String(name || '').trim();
  if (!trimmedName) {
    return loadWorkspaceState();
  }

  return mutateWorkspaceState(({ workspaces }) => {
    const id = buildWorkspaceId(trimmedName, workspaces);

    return {
      activeWorkspaceId: id,
      workspaces: {
        ...workspaces,
        [id]: createWorkspace(id, trimmedName),
      },
    };
  });
}

async function renameWorkspace(workspaceId, name) {
  const trimmedName = String(name || '').trim();
  if (!trimmedName) {
    return loadWorkspaceState();
  }

  return mutateWorkspaceState(({ workspaces, activeWorkspaceId }) => {
    if (!workspaces[workspaceId]) {
      return null;
    }

    const timestamp = new Date().toISOString();

    return {
      activeWorkspaceId,
      workspaces: {
        ...workspaces,
        [workspaceId]: {
          ...workspaces[workspaceId],
          name: trimmedName,
          updatedAt: timestamp,
        },
      },
    };
  });
}

async function deleteWorkspace(workspaceId) {
  return mutateWorkspaceState(({ workspaces, activeWorkspaceId }) => {
    if (workspaceId === DEFAULT_WORKSPACE_ID || !workspaces[workspaceId]) {
      return null;
    }

    const nextWorkspaces = { ...workspaces };
    delete nextWorkspaces[workspaceId];

    return {
      activeWorkspaceId: activeWorkspaceId === workspaceId
        ? DEFAULT_WORKSPACE_ID
        : activeWorkspaceId,
      workspaces: nextWorkspaces,
    };
  });
}

async function sendWorkspaceClearSignal(storageIdentity, workspaceId, timestamp) {
  const data = await storageGet(WORKSPACE_CLEAR_SIGNAL_STORAGE_KEY, chrome.storage.local);
  const signals = normalizeClearSignals(data[WORKSPACE_CLEAR_SIGNAL_STORAGE_KEY]);

  await storageSet({
    [WORKSPACE_CLEAR_SIGNAL_STORAGE_KEY]: {
      signals: {
        ...signals,
        [getClearSignalKey(storageIdentity, workspaceId)]: timestamp,
      },
      storageIdentity,
      updatedAt: timestamp,
      workspaceId,
    },
  }, chrome.storage.local);
}

async function clearWorkspace(workspaceId, options = {}) {
  const session = options.session || await createWorkspaceStorageSession();
  const timestamp = new Date().toISOString();
  let clearedWorkspaceId = workspaceId;
  const workspaceState = await mutateWorkspaceState(({ workspaces, activeWorkspaceId }) => {
    clearedWorkspaceId = workspaces[workspaceId] ? workspaceId : activeWorkspaceId;

    return {
      activeWorkspaceId,
      workspaces: {
        ...workspaces,
        [clearedWorkspaceId]: {
          ...workspaces[clearedWorkspaceId],
          annotations: {},
          annotationsUpdatedAt: timestamp,
          items: {},
          itemsUpdatedAt: timestamp,
          updatedAt: timestamp,
        },
      },
    };
  }, { session });

  await sendWorkspaceClearSignal(session.identity, clearedWorkspaceId, timestamp);

  return workspaceState;
}

async function saveWorkspaceItems(workspaceId, items, options = {}) {
  return mutateWorkspaceState(({ workspaces, activeWorkspaceId }) => {
    const activeId = workspaces[workspaceId] ? workspaceId : activeWorkspaceId;
    const timestamp = new Date().toISOString();

    return {
      activeWorkspaceId,
      workspaces: {
        ...workspaces,
        [activeId]: {
          ...workspaces[activeId],
          items: isPlainObject(items) ? items : {},
          itemsUpdatedAt: timestamp,
          updatedAt: timestamp,
        },
      },
    };
  }, options);
}

async function addItemToWorkspace(workspaceId, key, item) {
  return mutateWorkspaceState(({ workspaces, activeWorkspaceId }) => {
    const activeId = workspaces[workspaceId] ? workspaceId : activeWorkspaceId;
    const timestamp = new Date().toISOString();

    return {
      activeWorkspaceId,
      workspaces: {
        ...workspaces,
        [activeId]: {
          ...workspaces[activeId],
          items: {
            ...workspaces[activeId].items,
            [key]: { ...item },
          },
          itemsUpdatedAt: timestamp,
          updatedAt: timestamp,
        },
      },
    };
  });
}

async function removeItemFromWorkspace(workspaceId, key) {
  return mutateWorkspaceState(({ workspaces, activeWorkspaceId }) => {
    const activeId = workspaces[workspaceId] ? workspaceId : activeWorkspaceId;
    const nextItems = { ...workspaces[activeId].items };
    const timestamp = new Date().toISOString();
    delete nextItems[key];

    return {
      activeWorkspaceId,
      workspaces: {
        ...workspaces,
        [activeId]: {
          ...workspaces[activeId],
          items: nextItems,
          itemsUpdatedAt: timestamp,
          updatedAt: timestamp,
        },
      },
    };
  });
}

async function saveWorkspaceAnnotations(workspaceId, annotations, options = {}) {
  return mutateWorkspaceState(({ workspaces, activeWorkspaceId }) => {
    const activeId = workspaces[workspaceId] ? workspaceId : activeWorkspaceId;
    const timestamp = new Date().toISOString();

    return {
      activeWorkspaceId,
      workspaces: {
        ...workspaces,
        [activeId]: {
          ...workspaces[activeId],
          annotations: normalizeAnnotationSets(annotations),
          annotationsUpdatedAt: timestamp,
          updatedAt: timestamp,
        },
      },
    };
  }, options);
}

async function getCanvasAnnotations(workspaceId, canvasId, options = {}) {
  const { workspaces, activeWorkspaceId } = await loadWorkspaceState(options);
  const activeWorkspace = getActiveWorkspace(workspaces, workspaceId || activeWorkspaceId);
  const annotations = activeWorkspace.annotations || {};

  return Array.isArray(annotations[canvasId]) ? annotations[canvasId] : [];
}

async function saveCanvasAnnotations(workspaceId, canvasId, annotations, options = {}) {
  const session = options.session || await createWorkspaceStorageSession();
  let activeId = workspaceId;
  const workspaceState = await mutateWorkspaceState(async ({ workspaces, activeWorkspaceId }) => {
    activeId = workspaces[workspaceId] ? workspaceId : activeWorkspaceId;

    if (await wasWorkspaceClearedAfter(
      session.identity,
      activeId,
      options.mutationTimestamp
    )) {
      return null;
    }

    const nextAnnotations = {
      ...(workspaces[activeId].annotations || {}),
    };
    const mergedAnnotations = mergeCanvasAnnotations(
      nextAnnotations[canvasId],
      options.baseAnnotations,
      annotations
    );
    if (mergedAnnotations.length > 0) {
      nextAnnotations[canvasId] = mergedAnnotations;
    } else {
      delete nextAnnotations[canvasId];
    }

    const timestamp = new Date().toISOString();
    return {
      activeWorkspaceId,
      workspaces: {
        ...workspaces,
        [activeId]: {
          ...workspaces[activeId],
          annotations: normalizeAnnotationSets(nextAnnotations),
          annotationsUpdatedAt: timestamp,
          updatedAt: timestamp,
        },
      },
    };
  }, { session });

  if (await wasWorkspaceClearedAfter(
    session.identity,
    activeId,
    options.mutationTimestamp
  )) {
    return clearWorkspace(activeId, { session });
  }

  return workspaceState;
}

export {
  ACTIVE_WORKSPACE_STORAGE_KEY,
  DEFAULT_WORKSPACE_ID,
  LEGACY_BASKET_STORAGE_KEY,
  WORKSPACES_STORAGE_KEY,
  WORKSPACE_CLEAR_SIGNAL_STORAGE_KEY,
  WORKSPACE_INDEX_STORAGE_KEY,
  addItemToWorkspace,
  addWorkspace,
  clearWorkspace,
  createWorkspaceStorageSession,
  deleteWorkspace,
  getActiveWorkspace,
  getCanvasAnnotations,
  loadBrowserSyncWorkspaceState,
  loadWorkspaceState,
  renameWorkspace,
  removeItemFromWorkspace,
  saveCanvasAnnotations,
  saveWorkspaceItems,
  setActiveWorkspace,
  wasWorkspaceClearedAfter,
};
