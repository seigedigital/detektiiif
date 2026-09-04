const fs = require('fs-extra');
const path = require('path');

const packageJson = require('../package.json');

const TARGETS = ['chrome', 'firefox'];

function normalizeTarget(target) {
  const value = (target || 'chrome').toLowerCase();
  const aliases = {
    chromium: 'chrome',
    cws: 'chrome',
    ff: 'firefox',
    amo: 'firefox',
  };
  const normalized = aliases[value] || value;

  if (!TARGETS.includes(normalized)) {
    throw new Error(
      `Unknown extension target "${target}". Expected one of: ${TARGETS.join(', ')}.`
    );
  }

  return normalized;
}

function readJson(filePath) {
  return fs.readJsonSync(filePath);
}

function deepMerge(base, override) {
  const result = { ...base };

  for (const [key, value] of Object.entries(override || {})) {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      result[key] &&
      typeof result[key] === 'object' &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(result[key], value);
    } else {
      result[key] = value;
    }
  }

  return result;
}

function getThemeDir() {
  return path.resolve(__dirname, '..', 'src', 'themes', 'active');
}

function createManifest(target) {
  const normalizedTarget = normalizeTarget(target);
  const themeDir = getThemeDir();
  const commonManifest = readJson(path.join(themeDir, 'manifest.common.json'));
  const targetManifest = readJson(
    path.join(themeDir, `manifest.${normalizedTarget}.json`)
  );

  return deepMerge(
    deepMerge(
      {
        description: packageJson.description,
        version: packageJson.version,
      },
      commonManifest
    ),
    targetManifest
  );
}

function stringifyManifest(target) {
  return `${JSON.stringify(createManifest(target), null, 2)}\n`;
}

function getBuildPath(target) {
  return path.resolve(__dirname, '..', 'build', normalizeTarget(target));
}

function getPackageBaseName(target) {
  const manifest = createManifest(target);
  const name = manifest.name.replace(/\s+/g, '_');
  return `${name}-${manifest.version}-${normalizeTarget(target)}-mv3`;
}

module.exports = {
  TARGETS,
  createManifest,
  getBuildPath,
  getPackageBaseName,
  normalizeTarget,
  stringifyManifest,
};
