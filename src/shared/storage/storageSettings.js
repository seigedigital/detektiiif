const WORKSPACE_STORAGE_SETTINGS_KEY = 'workspaceStorageSettings';

const WORKSPACE_STORAGE_BACKENDS = {
  BROWSER_SYNC: 'browser-sync',
  GITHUB: 'github',
};

const DEFAULT_WORKSPACE_STORAGE_SETTINGS = {
  backend: WORKSPACE_STORAGE_BACKENDS.BROWSER_SYNC,
  github: {
    owner: '',
    repo: '',
    token: '',
  },
};

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function getStorageError() {
  const lastError = chrome.runtime && chrome.runtime.lastError;

  return lastError ? new Error(lastError.message) : null;
}

function localStorageGet(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (result) => {
      const error = getStorageError();
      if (error) {
        reject(error);
        return;
      }

      resolve(result || {});
    });
  });
}

function localStorageSet(data) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(data, () => {
      const error = getStorageError();
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function parseGitHubRepository(value) {
  const repository = String(value || '')
    .trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/^git@github\.com:/i, '')
    .replace(/\.git$/i, '')
    .replace(/^\/+|\/+$/g, '');
  const parts = repository.split('/').filter(Boolean);

  if (parts.length < 2) {
    return { owner: '', repo: '' };
  }

  return {
    owner: parts[0],
    repo: parts[1].replace(/\.git$/i, ''),
  };
}

function normalizeGitHubSettings(github) {
  const next = isPlainObject(github) ? github : {};
  const repository = parseGitHubRepository(next.repository);
  const owner = String(repository.owner || next.owner || '').trim();
  const repo = String(repository.repo || next.repo || '').trim().replace(/\.git$/i, '');
  return {
    owner,
    repo,
    token: String(next.token || '').trim(),
  };
}

function getGitHubRepositorySlug(github) {
  const normalized = normalizeGitHubSettings(github);

  return normalized.owner && normalized.repo
    ? `${normalized.owner}/${normalized.repo}`
    : '';
}

function normalizeWorkspaceStorageSettings(settings) {
  const next = isPlainObject(settings) ? settings : {};
  const backend = Object.values(WORKSPACE_STORAGE_BACKENDS).includes(next.backend)
    ? next.backend
    : WORKSPACE_STORAGE_BACKENDS.BROWSER_SYNC;

  return {
    backend,
    github: normalizeGitHubSettings(next.github),
  };
}

async function loadWorkspaceStorageSettings() {
  const data = await localStorageGet(WORKSPACE_STORAGE_SETTINGS_KEY);

  return normalizeWorkspaceStorageSettings(
    data[WORKSPACE_STORAGE_SETTINGS_KEY] || DEFAULT_WORKSPACE_STORAGE_SETTINGS
  );
}

async function saveWorkspaceStorageSettings(settings) {
  const normalized = normalizeWorkspaceStorageSettings(settings);

  await localStorageSet({ [WORKSPACE_STORAGE_SETTINGS_KEY]: normalized });

  return normalized;
}

function hasGitHubToken(settings) {
  const github = normalizeGitHubSettings(settings?.github);

  return Boolean(github.token);
}

function hasConfiguredGitHubStorage(settings) {
  const github = normalizeGitHubSettings(settings?.github);

  return Boolean(github.owner && github.repo);
}

export {
  DEFAULT_WORKSPACE_STORAGE_SETTINGS,
  WORKSPACE_STORAGE_BACKENDS,
  WORKSPACE_STORAGE_SETTINGS_KEY,
  getGitHubRepositorySlug,
  hasGitHubToken,
  hasConfiguredGitHubStorage,
  loadWorkspaceStorageSettings,
  normalizeWorkspaceStorageSettings,
  parseGitHubRepository,
  saveWorkspaceStorageSettings,
};
