const WORKSPACES_STORAGE_KEY = 'workspaces';
const ACTIVE_WORKSPACE_STORAGE_KEY = 'activeWorkspaceId';
const DEFAULT_WORKSPACE_ID = 'default';
const LEGACY_BASKET_STORAGE_KEY = 'basket';

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
  return {
    id,
    name,
    items: isPlainObject(items) ? items : {},
    annotations: isPlainObject(annotations) ? annotations : {},
    updatedAt: new Date().toISOString(),
  };
}

function createDefaultWorkspace(items = {}) {
  return createWorkspace(DEFAULT_WORKSPACE_ID, 'default', items);
}

function normalizeWorkspace(workspace, id) {
  if (!isPlainObject(workspace)) {
    return createWorkspace(id, id === DEFAULT_WORKSPACE_ID ? 'default' : id);
  }

  return {
    id: workspace.id || id,
    name: workspace.name || (id === DEFAULT_WORKSPACE_ID ? 'default' : id),
    items: isPlainObject(workspace.items) ? workspace.items : {},
    annotations: isPlainObject(workspace.annotations) ? workspace.annotations : {},
    updatedAt: workspace.updatedAt || new Date().toISOString(),
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

async function loadWorkspaceState() {
  const data = await storageGet([
    WORKSPACES_STORAGE_KEY,
    ACTIVE_WORKSPACE_STORAGE_KEY,
    LEGACY_BASKET_STORAGE_KEY,
  ]);
  const legacyItems = isPlainObject(data[LEGACY_BASKET_STORAGE_KEY])
    ? data[LEGACY_BASKET_STORAGE_KEY]
    : {};
  const workspaces = normalizeWorkspaces(data[WORKSPACES_STORAGE_KEY], legacyItems);
  const activeWorkspaceId = normalizeActiveWorkspaceId(
    workspaces,
    data[ACTIVE_WORKSPACE_STORAGE_KEY]
  );

  if (Object.keys(legacyItems).length > 0) {
    workspaces[DEFAULT_WORKSPACE_ID] = {
      ...workspaces[DEFAULT_WORKSPACE_ID],
      items: {
        ...legacyItems,
        ...(workspaces[DEFAULT_WORKSPACE_ID].items || {}),
      },
    };
  }

  if (!data[WORKSPACES_STORAGE_KEY] || data[LEGACY_BASKET_STORAGE_KEY]) {
    await storageSet({
      [WORKSPACES_STORAGE_KEY]: workspaces,
      [ACTIVE_WORKSPACE_STORAGE_KEY]: activeWorkspaceId,
    });
    await storageRemove(LEGACY_BASKET_STORAGE_KEY);
  }

  return { workspaces, activeWorkspaceId };
}

async function saveWorkspaceState(workspaces, activeWorkspaceId) {
  const normalized = normalizeWorkspaces(workspaces);
  const activeId = normalizeActiveWorkspaceId(normalized, activeWorkspaceId);

  await storageSet({
    [WORKSPACES_STORAGE_KEY]: normalized,
    [ACTIVE_WORKSPACE_STORAGE_KEY]: activeId,
  });

  return { workspaces: normalized, activeWorkspaceId: activeId };
}

function getActiveWorkspace(workspaces, activeWorkspaceId) {
  const activeId = normalizeActiveWorkspaceId(workspaces, activeWorkspaceId);

  return workspaces[activeId] || createDefaultWorkspace();
}

async function setActiveWorkspace(activeWorkspaceId) {
  const { workspaces } = await loadWorkspaceState();
  const activeId = normalizeActiveWorkspaceId(workspaces, activeWorkspaceId);

  await storageSet({ [ACTIVE_WORKSPACE_STORAGE_KEY]: activeId });

  return { workspaces, activeWorkspaceId: activeId };
}

async function addWorkspace(name) {
  const trimmedName = String(name || '').trim();
  if (!trimmedName) {
    return loadWorkspaceState();
  }

  const { workspaces } = await loadWorkspaceState();
  const id = buildWorkspaceId(trimmedName, workspaces);
  const nextWorkspaces = {
    ...workspaces,
    [id]: createWorkspace(id, trimmedName),
  };

  return saveWorkspaceState(nextWorkspaces, id);
}

async function renameWorkspace(workspaceId, name) {
  const trimmedName = String(name || '').trim();
  if (!trimmedName) {
    return loadWorkspaceState();
  }

  const { workspaces, activeWorkspaceId } = await loadWorkspaceState();
  if (!workspaces[workspaceId]) {
    return { workspaces, activeWorkspaceId };
  }

  const nextWorkspaces = {
    ...workspaces,
    [workspaceId]: {
      ...workspaces[workspaceId],
      name: trimmedName,
      updatedAt: new Date().toISOString(),
    },
  };

  return saveWorkspaceState(nextWorkspaces, activeWorkspaceId);
}

async function deleteWorkspace(workspaceId) {
  const { workspaces, activeWorkspaceId } = await loadWorkspaceState();

  if (workspaceId === DEFAULT_WORKSPACE_ID || !workspaces[workspaceId]) {
    return { workspaces, activeWorkspaceId };
  }

  const nextWorkspaces = { ...workspaces };
  delete nextWorkspaces[workspaceId];

  return saveWorkspaceState(
    nextWorkspaces,
    activeWorkspaceId === workspaceId ? DEFAULT_WORKSPACE_ID : activeWorkspaceId
  );
}

async function saveWorkspaceItems(workspaceId, items) {
  const { workspaces, activeWorkspaceId } = await loadWorkspaceState();
  const activeId = workspaces[workspaceId] ? workspaceId : activeWorkspaceId;
  const nextWorkspaces = {
    ...workspaces,
    [activeId]: {
      ...workspaces[activeId],
      items: isPlainObject(items) ? items : {},
      updatedAt: new Date().toISOString(),
    },
  };

  return saveWorkspaceState(nextWorkspaces, activeWorkspaceId);
}

async function addItemToWorkspace(workspaceId, key, item) {
  const { workspaces, activeWorkspaceId } = await loadWorkspaceState();
  const activeId = workspaces[workspaceId] ? workspaceId : activeWorkspaceId;
  const workspace = workspaces[activeId];
  const nextItems = {
    ...workspace.items,
    [key]: { ...item },
  };

  return saveWorkspaceItems(activeId, nextItems);
}

async function removeItemFromWorkspace(workspaceId, key) {
  const { workspaces, activeWorkspaceId } = await loadWorkspaceState();
  const activeId = workspaces[workspaceId] ? workspaceId : activeWorkspaceId;
  const workspace = workspaces[activeId];
  const nextItems = { ...workspace.items };
  delete nextItems[key];

  return saveWorkspaceItems(activeId, nextItems);
}

async function saveWorkspaceAnnotations(workspaceId, annotations) {
  const { workspaces, activeWorkspaceId } = await loadWorkspaceState();
  const activeId = workspaces[workspaceId] ? workspaceId : activeWorkspaceId;
  const workspace = workspaces[activeId];
  const nextWorkspaces = {
    ...workspaces,
    [activeId]: {
      ...workspace,
      annotations: isPlainObject(annotations) ? annotations : {},
      updatedAt: new Date().toISOString(),
    },
  };

  return saveWorkspaceState(nextWorkspaces, activeWorkspaceId);
}

async function getCanvasAnnotations(workspaceId, canvasId) {
  const { workspaces, activeWorkspaceId } = await loadWorkspaceState();
  const activeWorkspace = getActiveWorkspace(workspaces, workspaceId || activeWorkspaceId);
  const annotations = activeWorkspace.annotations || {};

  return Array.isArray(annotations[canvasId]) ? annotations[canvasId] : [];
}

async function saveCanvasAnnotations(workspaceId, canvasId, annotations) {
  const { workspaces, activeWorkspaceId } = await loadWorkspaceState();
  const activeId = workspaces[workspaceId] ? workspaceId : activeWorkspaceId;
  const workspace = workspaces[activeId];
  const nextAnnotations = {
    ...(workspace.annotations || {}),
    [canvasId]: Array.isArray(annotations) ? annotations : [],
  };

  return saveWorkspaceAnnotations(activeId, nextAnnotations);
}

export {
  ACTIVE_WORKSPACE_STORAGE_KEY,
  DEFAULT_WORKSPACE_ID,
  LEGACY_BASKET_STORAGE_KEY,
  WORKSPACES_STORAGE_KEY,
  addItemToWorkspace,
  addWorkspace,
  deleteWorkspace,
  getActiveWorkspace,
  getCanvasAnnotations,
  loadWorkspaceState,
  renameWorkspace,
  removeItemFromWorkspace,
  saveCanvasAnnotations,
  saveWorkspaceItems,
  saveWorkspaceState,
  setActiveWorkspace,
};
