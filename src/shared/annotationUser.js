const ANNOTATION_USER_SETTINGS_KEY = 'annotationUserSettings';
const DEFAULT_ANNOTATION_USER_NAME = 'detektIIIF User';

const DEFAULT_ANNOTATION_USER_SETTINGS = {
  displayName: '',
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

function normalizeAnnotationDisplayName(value) {
  return String(value || '').trim();
}

function normalizeAnnotationUserSettings(settings) {
  const next = isPlainObject(settings) ? settings : {};

  return {
    displayName: normalizeAnnotationDisplayName(next.displayName),
  };
}

function getAnnotationUserDisplayName(settings) {
  return normalizeAnnotationUserSettings(settings).displayName || DEFAULT_ANNOTATION_USER_NAME;
}

async function loadAnnotationUserSettings() {
  const data = await localStorageGet(ANNOTATION_USER_SETTINGS_KEY);

  return normalizeAnnotationUserSettings(
    data[ANNOTATION_USER_SETTINGS_KEY] || DEFAULT_ANNOTATION_USER_SETTINGS
  );
}

async function saveAnnotationUserSettings(settings) {
  const normalized = normalizeAnnotationUserSettings(settings);

  await localStorageSet({ [ANNOTATION_USER_SETTINGS_KEY]: normalized });

  return normalized;
}

export {
  ANNOTATION_USER_SETTINGS_KEY,
  DEFAULT_ANNOTATION_USER_NAME,
  getAnnotationUserDisplayName,
  loadAnnotationUserSettings,
  normalizeAnnotationUserSettings,
  saveAnnotationUserSettings,
};
