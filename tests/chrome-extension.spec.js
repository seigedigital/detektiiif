const fs = require('fs/promises');
const http = require('http');
const os = require('os');
const path = require('path');

const { chromium, expect, test } = require('@playwright/test');

const extensionPath = path.resolve(__dirname, '..', 'build', 'chrome');
const fixtureRoot = path.join(__dirname, 'fixtures');
const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64'
);

const resourceRoutes = new Map([
  ['/api/iiif/O27689/manifest.json', {
    fixture: 'resources/courtauld-manifest-o27689.json',
    headContentType: 'text/html; charset=utf-8',
  }],
  ['/records/O999/data.json', 'resources/semantic-link-manifest.json'],
  ['/records/O998/data.json', {
    fixture: 'resources/semantic-link-manifest.json',
    headContentType: 'text/html; charset=utf-8',
  }],
  ['/apis/iiif/image/v2/18966/info.json', 'resources/belvedere-image-18966-info.json'],
  ['/apis/iiif/presentation/v2/1-objects-5686/manifest', 'resources/belvedere-manifest-5686.json'],
  ['/iiif/presentation-v2/manifest.json', 'resources/presentation-v2-manifest.json'],
  ['/iiif/presentation-v3/manifest.json', 'resources/presentation-v3-manifest.json'],
  ['/iiif/presentation-v4/manifest.json', 'resources/presentation-v4-manifest.json'],
  ['/iiif/collection-v2/collection.json', 'resources/collection-v2.json'],
  ['/iiif/collection-v4/collection.json', 'resources/collection-v4.json'],
  ['/iiif/image-v2/info.json', 'resources/image-v2-info.json'],
  ['/objects/5686/json', 'resources/belvedere-object-5686.json'],
]);

const fixtureCases = [
  {
    name: 'detects IIIF resources from semantic link clues',
    page: 'semantic-link.html',
    popupTab: /^Manifests/,
    popupText: () => 'Semantic Link Fixture Manifest',
    expectedRequests: [
      'HEAD /records/O999/data.json',
      'GET /records/O999/data.json',
      'HEAD /records/O998/data.json',
    ],
    expectedAbsentRequests: ['GET /records/O998/data.json'],
    expected: () => ({
      collections: [],
      images: [],
      manifests: ['Semantic Link Fixture Manifest'],
    }),
  },
  {
    name: 'detects relative Courtauld manifest links',
    page: 'courtauld-object.html',
    pageHost: 'gallerycollections.courtauld.ac.uk',
    pagePath: '/object-p-1966-gp-304-3',
    popupTab: /^Manifests/,
    popupText: () => 'Courtauld Fixture Manifest',
    expectedRequests: [
      'HEAD /api/iiif/O27689/manifest.json',
      'GET /api/iiif/O27689/manifest.json',
    ],
    expected: () => ({
      collections: [],
      images: [],
      manifests: ['Courtauld Fixture Manifest'],
    }),
  },
  {
    name: 'detects Belvedere object pages via institutional rule',
    page: 'belvedere-object.html',
    pageHost: 'sammlung.belvedere.at',
    pagePath: '/objects/5686/unter-den-linden-abendlandschaft',
    popupTab: /^Manifests/,
    popupText: () => 'Belvedere Fixture Manifest',
    expectedRequests: [
      'HEAD /objects/5686/json',
      'GET /objects/5686/json',
    ],
    expected: (origin) => ({
      collections: [],
      images: [`${origin}/apis/iiif/image/v2/18966/info.json`],
      manifests: ['Belvedere Fixture Manifest'],
    }),
  },
  {
    name: 'detects Presentation API v2 manifests from fixture HTML',
    page: 'presentation-v2.html',
    popupTab: /^Manifests/,
    popupText: () => 'Fixture Presentation 2 Manifest',
    expected: () => ({
      collections: [],
      images: [],
      manifests: ['Fixture Presentation 2 Manifest'],
    }),
  },
  {
    name: 'detects Presentation API v3 manifests from fixture HTML',
    page: 'presentation-v3.html',
    popupTab: /^Manifests/,
    popupText: () => 'Fixture Presentation 3 Manifest',
    expected: () => ({
      collections: [],
      images: [],
      manifests: ['Fixture Presentation 3 Manifest'],
    }),
  },
  {
    name: 'detects Presentation API v4 manifests from fixture HTML',
    page: 'presentation-v4.html',
    popupTab: /^Manifests/,
    popupText: () => 'Fixture Presentation 4 Manifest',
    expected: () => ({
      collections: [],
      images: [],
      manifests: ['Fixture Presentation 4 Manifest'],
    }),
  },
  {
    name: 'detects Presentation API v2 collections from fixture HTML',
    page: 'collection-v2.html',
    popupTab: /^Collections/,
    popupText: () => 'Fixture Presentation 2 Collection',
    expected: () => ({
      collections: ['Fixture Presentation 2 Collection'],
      images: [],
      manifests: [],
    }),
  },
  {
    name: 'detects Presentation API v4 collections from fixture HTML',
    page: 'collection-v4.html',
    popupTab: /^Collections/,
    popupText: () => 'Fixture Presentation 4 Collection',
    expected: () => ({
      collections: ['Fixture Presentation 4 Collection'],
      images: [],
      manifests: [],
    }),
  },
  {
    name: 'detects Image API resources from fixture image URLs',
    page: 'image-api-v2.html',
    popupTab: /^Images/,
    popupText: (origin) => `${origin}/iiif/image-v2/info.json`,
    expected: (origin) => ({
      collections: [],
      images: [`${origin}/iiif/image-v2/info.json`],
      manifests: [],
    }),
  },
];

function renderTemplate(content, origin) {
  return content.replace(/\{\{origin\}\}/g, origin);
}

async function readFixture(relativePath, origin) {
  const filePath = path.join(fixtureRoot, relativePath);
  const content = await fs.readFile(filePath, 'utf8');

  return renderTemplate(content, origin);
}

function sendBuffer(req, res, body, contentType) {
  res.writeHead(200, {
    'access-control-allow-origin': '*',
    'content-length': body.length,
    'content-type': contentType,
  });

  if (req.method !== 'HEAD') {
    res.end(body);
  } else {
    res.end();
  }
}

async function sendTextFixture(req, res, relativePath, origin, contentType) {
  const body = Buffer.from(await readFixture(relativePath, origin));
  sendBuffer(req, res, body, contentType);
}

async function handleFixtureRequest(req, res, url, origin, pageFixture, pagePath) {
  if (url.pathname === '/' || url.pathname === '/page.html' || url.pathname === pagePath) {
    await sendTextFixture(
      req,
      res,
      path.join('pages', pageFixture),
      origin,
      'text/html; charset=utf-8'
    );
    return;
  }

  const resourceFixture = resourceRoutes.get(url.pathname);
  if (resourceFixture) {
    const fixtureConfig = typeof resourceFixture === 'string'
      ? { fixture: resourceFixture }
      : resourceFixture;
    const contentType = req.method === 'HEAD' && fixtureConfig.headContentType
      ? fixtureConfig.headContentType
      : 'application/json; charset=utf-8';

    await sendTextFixture(
      req,
      res,
      fixtureConfig.fixture,
      origin,
      contentType
    );
    return;
  }

  if (
    url.pathname.startsWith('/thumbs/') ||
    /\/full\/[^/]+\/[^/]+\/default\.jpg$/.test(url.pathname)
  ) {
    sendBuffer(req, res, tinyPng, 'image/png');
    return;
  }

  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
}

function createFixtureServer(pageFixture, options = {}) {
  const requests = [];
  const server = http.createServer((req, res) => {
    const origin = `http://${req.headers.host}`;
    const url = new URL(req.url, origin);

    requests.push(`${req.method} ${url.pathname}`);

    handleFixtureRequest(
      req,
      res,
      url,
      origin,
      pageFixture,
      options.pagePath
    ).catch((error) => {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end(error.stack || error.message);
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);

      const { port } = server.address();
      const origin = `http://${options.pageHost || '127.0.0.1'}:${port}`;
      const pagePath = options.pagePath || '/page.html';

      resolve({
        close: () => new Promise((done) => server.close(done)),
        origin,
        requests,
        url: `${origin}${pagePath}`,
      });
    });
  });
}

function captureServiceWorkerLogs(context, logs) {
  const attach = (worker) => {
    worker.on('console', (message) => {
      logs.push(`[service worker:${message.type()}] ${message.text()}`);
    });
  };

  context.serviceWorkers().forEach(attach);
  context.on('serviceworker', attach);
}

async function launchExtensionContext() {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'detektiiif3-'));
  const launchOptions = {
    headless: process.env.HEADED !== '1',
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--host-resolver-rules=MAP sammlung.belvedere.at 127.0.0.1,MAP gallerycollections.courtauld.ac.uk 127.0.0.1',
    ],
  };

  if (process.env.CHROME_EXECUTABLE) {
    launchOptions.executablePath = process.env.CHROME_EXECUTABLE;
  } else {
    launchOptions.channel = 'chromium';
  }

  const context = await chromium.launchPersistentContext(
    userDataDir,
    launchOptions
  );

  return { context, userDataDir };
}

async function getServiceWorker(context) {
  let [worker] = context.serviceWorkers();
  if (!worker) {
    worker = await context.waitForEvent('serviceworker');
  }

  await worker.evaluate(() => chrome.runtime.id);

  return worker;
}

async function getExtensionId(context) {
  const worker = await getServiceWorker(context);

  return worker.url().split('/')[2];
}

async function queryTabId(context, url) {
  const worker = await getServiceWorker(context);

  return worker.evaluate(async (tabUrl) => {
    const tabs = await chrome.tabs.query({ url: tabUrl });
    return tabs[0] ? tabs[0].id : null;
  }, url);
}

async function getRawTabStorage(context) {
  const worker = await getServiceWorker(context);

  return worker.evaluate(() => (
    new Promise((resolve) => {
      chrome.storage.local.get(['tabStorage'], (result) => {
        resolve(result.tabStorage || '');
      });
    })
  ));
}

async function getRawLocalStorage(context) {
  const worker = await getServiceWorker(context);

  return worker.evaluate(() => (
    new Promise((resolve) => {
      chrome.storage.local.get(null, (result) => resolve(result || {}));
    })
  ));
}

async function setLocalStorage(context, data) {
  const worker = await getServiceWorker(context);

  return worker.evaluate((value) => (
    new Promise((resolve) => {
      chrome.storage.local.set(value, () => resolve());
    })
  ), data);
}

async function getDetectedLabels(context, tabId) {
  const worker = await getServiceWorker(context);

  return worker.evaluate((id) => (
    new Promise((resolve) => {
      chrome.storage.local.get(['tabStorage'], (result) => {
        if (!result.tabStorage) {
          resolve(null);
          return;
        }

        const tabStorage = JSON.parse(result.tabStorage);
        const tabData = tabStorage[String(id)];

        if (!tabData || !tabData.iiif) {
          resolve(null);
          return;
        }

        resolve({
          collections: Object.values(tabData.iiif.collections)
            .map((item) => item.label)
            .sort(),
          images: Object.values(tabData.iiif.images)
            .map((item) => item.label)
            .sort(),
          manifests: Object.values(tabData.iiif.manifests)
            .map((item) => item.label)
            .sort(),
        });
      });
    })
  ), tabId);
}

function workspaceChunkKey(workspaceId, type, index) {
  return `workspace:${encodeURIComponent(workspaceId)}:${type}:${index}`;
}

function parseWorkspaceJSON(value, fallback) {
  if (!value) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : fallback;
  } catch {
    return fallback;
  }
}

async function getRawSyncStorage(context) {
  const worker = await getServiceWorker(context);

  return worker.evaluate(() => (
    new Promise((resolve) => {
      chrome.storage.sync.get(null, (result) => resolve(result || {}));
    })
  ));
}

async function getWorkspaceState(context) {
  const storage = await getRawSyncStorage(context);
  const workspaceIndex = storage.workspaceIndex;

  if (!workspaceIndex || !workspaceIndex.workspaces) {
    return {
      activeWorkspaceId: storage.activeWorkspaceId || null,
      workspaces: storage.workspaces || {},
    };
  }

  const workspaces = {};
  for (const workspaceId of Object.keys(workspaceIndex.workspaces)) {
    const metadata = workspaceIndex.workspaces[workspaceId];
    const itemsChunks = [];
    const annotationsChunks = [];

    for (let index = 0; index < (metadata.itemsChunkCount || 0); index += 1) {
      itemsChunks.push(storage[workspaceChunkKey(workspaceId, 'items', index)] || '');
    }

    for (let index = 0; index < (metadata.annotationsChunkCount || 0); index += 1) {
      annotationsChunks.push(storage[workspaceChunkKey(workspaceId, 'annotations', index)] || '');
    }

    workspaces[workspaceId] = {
      ...metadata,
      annotations: parseWorkspaceJSON(annotationsChunks.join(''), {}),
      items: parseWorkspaceJSON(itemsChunks.join(''), {}),
    };
  }

  return {
    activeWorkspaceId: storage.activeWorkspaceId || null,
    workspaces,
  };
}

async function setWorkspaceState(context, workspaces, activeWorkspaceId = 'default') {
  const worker = await getServiceWorker(context);

  return worker.evaluate(
    ({ nextWorkspaces, nextActiveWorkspaceId }) => (
      new Promise((resolve) => {
        chrome.storage.sync.get(null, (storage) => {
          const keysToRemove = Object.keys(storage || {}).filter((key) => (
            key === 'basket' ||
            key === 'workspaceIndex' ||
            key.startsWith('workspace:')
          ));

          chrome.storage.sync.remove(keysToRemove, () => {
            chrome.storage.sync.set({
              activeWorkspaceId: nextActiveWorkspaceId,
              workspaces: nextWorkspaces,
            }, resolve);
          });
        });
      })
    ),
    {
      nextActiveWorkspaceId: activeWorkspaceId,
      nextWorkspaces: workspaces,
    }
  );
}

async function setActiveWorkspaceInSyncStorage(context, activeWorkspaceId) {
  const worker = await getServiceWorker(context);

  return worker.evaluate(
    (nextActiveWorkspaceId) => (
      new Promise((resolve) => {
        chrome.storage.sync.set({ activeWorkspaceId: nextActiveWorkspaceId }, resolve);
      })
    ),
    activeWorkspaceId
  );
}

async function attachFailureDiagnostics(testInfo, fixture, logs, context) {
  await testInfo.attach('fixture-requests', {
    body: fixture.requests.join('\n') || '(no fixture requests)',
    contentType: 'text/plain',
  });

  await testInfo.attach('service-worker-logs', {
    body: logs.join('\n') || '(no service worker logs)',
    contentType: 'text/plain',
  });

  if (context) {
    const rawStorage = await getRawTabStorage(context).catch((error) => (
      error.stack || error.message
    ));
    await testInfo.attach('tab-storage', {
      body: rawStorage || '(empty tabStorage)',
      contentType: 'application/json',
    });
  }
}

for (const fixtureCase of fixtureCases) {
  test(fixtureCase.name, async ({}, testInfo) => {
    const fixture = await createFixtureServer(fixtureCase.page, fixtureCase);
    const logs = [];
    let context;
    let userDataDir;

    try {
      ({ context, userDataDir } = await launchExtensionContext());
      captureServiceWorkerLogs(context, logs);

      const extensionId = await getExtensionId(context);
      const page = await context.newPage();
      await page.goto(fixture.url);
      await page.waitForLoadState('networkidle');

      await expect.poll(() => queryTabId(context, page.url())).not.toBeNull();
      const tabId = await queryTabId(context, page.url());
      const expected = fixtureCase.expected(fixture.origin);

      await expect.poll(
        () => getDetectedLabels(context, tabId),
        { timeout: 20000 }
      ).toEqual(expected);

      for (const request of fixtureCase.expectedRequests || []) {
        expect(fixture.requests).toContain(request);
      }

      for (const request of fixtureCase.expectedAbsentRequests || []) {
        expect(fixture.requests).not.toContain(request);
      }

      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${extensionId}/popup.html?tabId=${tabId}`);
      await popup.getByRole('tab', { name: fixtureCase.popupTab }).click();

      await expect(
        popup.getByText(fixtureCase.popupText(fixture.origin), { exact: true })
      ).toBeVisible();
    } catch (error) {
      await attachFailureDiagnostics(testInfo, fixture, logs, context);
      throw error;
    } finally {
      if (context) {
        await context.close();
      }
      await fixture.close();

      if (userDataDir) {
        await fs.rm(userDataDir, { recursive: true, force: true });
      }
    }
  });
}

test('resets detected resources when the same tab navigates to another page', async ({}, testInfo) => {
  const firstFixture = await createFixtureServer('presentation-v2.html');
  const secondFixture = await createFixtureServer('presentation-v3.html');
  const logs = [];
  let context;
  let userDataDir;

  try {
    ({ context, userDataDir } = await launchExtensionContext());
    captureServiceWorkerLogs(context, logs);
    await getExtensionId(context);

    const page = await context.newPage();
    await page.goto(firstFixture.url);
    await page.waitForLoadState('networkidle');
    let tabId = await queryTabId(context, page.url());

    await expect.poll(() => getDetectedLabels(context, tabId), { timeout: 20000 }).toEqual({
      collections: [],
      images: [],
      manifests: ['Fixture Presentation 2 Manifest'],
    });

    await page.goto(secondFixture.url);
    await page.waitForLoadState('networkidle');
    tabId = await queryTabId(context, page.url());

    await expect.poll(() => getDetectedLabels(context, tabId), { timeout: 20000 }).toEqual({
      collections: [],
      images: [],
      manifests: ['Fixture Presentation 3 Manifest'],
    });
  } catch (error) {
    await attachFailureDiagnostics(testInfo, secondFixture, logs, context);
    throw error;
  } finally {
    if (context) await context.close();
    await firstFixture.close();
    await secondFixture.close();
    if (userDataDir) await fs.rm(userDataDir, { recursive: true, force: true });
  }
});

test('honors ignored domains edited from the options page', async ({}, testInfo) => {
  const fixture = await createFixtureServer('presentation-v3.html');
  const logs = [];
  let context;
  let userDataDir;

  try {
    ({ context, userDataDir } = await launchExtensionContext());
    captureServiceWorkerLogs(context, logs);

    const extensionId = await getExtensionId(context);
    const optionsPage = await context.newPage();
    await optionsPage.goto(`chrome-extension://${extensionId}/options.html`);
    await optionsPage.getByRole('button', { name: /Advanced Settings/ }).click();

    const ignoreDomainsField = optionsPage.getByLabel('Excluded domains');
    await expect(ignoreDomainsField).toHaveValue(/google\.com/);

    await ignoreDomainsField.fill('127.0.0.1\nhttps://example.org:8443/some/path\n127.0.0.1');

    await expect.poll(async () => {
      const storage = await getRawLocalStorage(context);
      return storage.ignoreDomains;
    }).toEqual(['127.0.0.1', 'example.org']);

    const blockedPage = await context.newPage();
    await blockedPage.goto(fixture.url);
    await blockedPage.waitForLoadState('networkidle');

    await expect.poll(async () => {
      const tabId = await queryTabId(context, blockedPage.url());

      return tabId ? getDetectedLabels(context, tabId) : null;
    }, { timeout: 5000 }).toEqual({
      collections: [],
      images: [],
      manifests: [],
    });
    expect(fixture.requests).not.toContain('HEAD /iiif/presentation-v3/manifest.json');
    expect(fixture.requests).not.toContain('GET /iiif/presentation-v3/manifest.json');

    await blockedPage.close();

    await ignoreDomainsField.fill('');

    await expect.poll(async () => {
      const storage = await getRawLocalStorage(context);
      return storage.ignoreDomains;
    }).toEqual([]);

    const allowedPage = await context.newPage();
    await allowedPage.goto(fixture.url);
    await allowedPage.waitForLoadState('networkidle');

    await expect.poll(async () => {
      const tabId = await queryTabId(context, allowedPage.url());

      return tabId ? getDetectedLabels(context, tabId) : null;
    }, { timeout: 20000 }).toEqual({
      collections: [],
      images: [],
      manifests: ['Fixture Presentation 3 Manifest'],
    });

    await ignoreDomainsField.fill('127.0.0.1');
    await expect.poll(async () => {
      const storage = await getRawLocalStorage(context);
      return storage.ignoreDomains;
    }).toEqual(['127.0.0.1']);

    await expect.poll(async () => {
      const tabId = await queryTabId(context, allowedPage.url());

      return tabId ? getDetectedLabels(context, tabId) : null;
    }).toEqual({
      collections: [],
      images: [],
      manifests: [],
    });

    await allowedPage.reload();
    await allowedPage.waitForLoadState('networkidle');
    await expect.poll(async () => {
      const tabId = await queryTabId(context, allowedPage.url());

      return tabId ? getDetectedLabels(context, tabId) : null;
    }).toEqual({
      collections: [],
      images: [],
      manifests: [],
    });
  } catch (error) {
    await attachFailureDiagnostics(testInfo, fixture, logs, context);
    throw error;
  } finally {
    if (context) {
      await context.close();
    }
    await fixture.close();

    if (userDataDir) {
      await fs.rm(userDataDir, { recursive: true, force: true });
    }
  }
});

test('manages workspaces and adds manifests from the popup', async ({}, testInfo) => {
  const fixture = await createFixtureServer('presentation-v3.html');
  const logs = [];
  let context;
  let userDataDir;

  try {
    ({ context, userDataDir } = await launchExtensionContext());
    captureServiceWorkerLogs(context, logs);

    const extensionId = await getExtensionId(context);
    const page = await context.newPage();
    await page.goto(fixture.url);
    await page.waitForLoadState('networkidle');

    await expect.poll(() => queryTabId(context, page.url())).not.toBeNull();
    const tabId = await queryTabId(context, page.url());

    await expect.poll(
      () => getDetectedLabels(context, tabId),
      { timeout: 20000 }
    ).toEqual({
      collections: [],
      images: [],
      manifests: ['Fixture Presentation 3 Manifest'],
    });

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html?tabId=${tabId}`);
    await popup.getByRole('tab', { name: /^Manifests/ }).click();
    await popup.getByRole('button', { name: 'Add to Workspace' }).click();

    await expect.poll(async () => {
      const state = await getWorkspaceState(context);
      return Object.keys(state.workspaces.default.items).length;
    }).toBe(1);

    await popup.getByRole('tab', { name: /^Workspaces/ }).click();

    const clearCanvasId = 'https://example.org/iiif/canvas/clear-workspace';
    const stateWithItem = await getWorkspaceState(context);
    await setWorkspaceState(context, {
      ...stateWithItem.workspaces,
      default: {
        ...stateWithItem.workspaces.default,
        annotations: {
          [clearCanvasId]: [{
            body: {
              format: 'text/plain',
              type: 'TextualBody',
              value: 'This annotation should be cleared',
            },
            id: 'clear-workspace-annotation',
            motivation: 'commenting',
            target: clearCanvasId,
            type: 'Annotation',
          }],
        },
      },
    }, stateWithItem.activeWorkspaceId);

    await expect.poll(async () => {
      const state = await getWorkspaceState(context);
      return {
        annotationCount: state.workspaces.default.annotations[clearCanvasId].length,
        itemCount: Object.keys(state.workspaces.default.items).length,
      };
    }).toEqual({
      annotationCount: 1,
      itemCount: 1,
    });

    await popup.getByRole('button', { name: 'Clear Workspace' }).click();
    await expect(popup.getByText('Remove all items and annotations from this workspace?')).toBeVisible();
    await popup.getByRole('button', { name: 'Yes' }).click();

    await expect.poll(async () => {
      const state = await getWorkspaceState(context);
      return {
        annotationCount: Object.keys(state.workspaces.default.annotations).length,
        itemCount: Object.keys(state.workspaces.default.items).length,
      };
    }).toEqual({
      annotationCount: 0,
      itemCount: 0,
    });

    const rawSyncStorageAfterClear = await getRawSyncStorage(context);
    expect(Object.keys(rawSyncStorageAfterClear).filter((key) => (
      key.startsWith('workspace:default:items:') ||
      key.startsWith('workspace:default:annotations:')
    ))).toEqual([]);

    popup.once('dialog', (dialog) => dialog.accept('Research'));
    await popup.getByRole('button', { name: 'Create workspace' }).click();

    await expect.poll(async () => {
      const state = await getWorkspaceState(context);
      return state.activeWorkspaceId;
    }).toBe('research');

    popup.once('dialog', (dialog) => dialog.accept('Research Notes'));
    await popup.getByRole('button', { name: 'Rename workspace' }).click();

    await expect.poll(async () => {
      const state = await getWorkspaceState(context);
      return state.workspaces.research.name;
    }).toBe('Research Notes');

    popup.once('dialog', (dialog) => dialog.accept());
    await popup.getByRole('button', { name: 'Delete workspace' }).click();

    await expect.poll(async () => {
      const state = await getWorkspaceState(context);
      return {
        activeWorkspaceId: state.activeWorkspaceId,
        hasResearch: Boolean(state.workspaces.research),
      };
    }).toEqual({
      activeWorkspaceId: 'default',
      hasResearch: false,
    });
  } catch (error) {
    await attachFailureDiagnostics(testInfo, fixture, logs, context);
    throw error;
  } finally {
    if (context) {
      await context.close();
    }
    await fixture.close();

    if (userDataDir) {
      await fs.rm(userDataDir, { recursive: true, force: true });
    }
  }
});

test('preserves concurrent Browser Sync updates from separate popup contexts', async ({}, testInfo) => {
  const firstFixture = await createFixtureServer('presentation-v2.html');
  const secondFixture = await createFixtureServer('presentation-v3.html');
  const logs = [];
  let context;
  let userDataDir;

  try {
    ({ context, userDataDir } = await launchExtensionContext());
    captureServiceWorkerLogs(context, logs);
    const extensionId = await getExtensionId(context);
    const firstPage = await context.newPage();
    const secondPage = await context.newPage();

    await Promise.all([
      firstPage.goto(firstFixture.url),
      secondPage.goto(secondFixture.url),
    ]);
    await Promise.all([
      firstPage.waitForLoadState('networkidle'),
      secondPage.waitForLoadState('networkidle'),
    ]);

    const firstTabId = await queryTabId(context, firstPage.url());
    const secondTabId = await queryTabId(context, secondPage.url());
    await expect.poll(() => getDetectedLabels(context, firstTabId)).toMatchObject({
      manifests: ['Fixture Presentation 2 Manifest'],
    });
    await expect.poll(() => getDetectedLabels(context, secondTabId)).toMatchObject({
      manifests: ['Fixture Presentation 3 Manifest'],
    });

    const firstPopup = await context.newPage();
    const secondPopup = await context.newPage();
    await Promise.all([
      firstPopup.goto(`chrome-extension://${extensionId}/popup.html?tabId=${firstTabId}`),
      secondPopup.goto(`chrome-extension://${extensionId}/popup.html?tabId=${secondTabId}`),
    ]);
    await Promise.all([
      firstPopup.getByRole('tab', { name: /^Manifests/ }).click(),
      secondPopup.getByRole('tab', { name: /^Manifests/ }).click(),
    ]);
    await Promise.all([
      firstPopup.getByRole('button', { name: 'Add to Workspace' }).click(),
      secondPopup.getByRole('button', { name: 'Add to Workspace' }).click(),
    ]);

    await expect.poll(async () => {
      const state = await getWorkspaceState(context);
      return Object.values(state.workspaces.default.items)
        .map((item) => item.label)
        .sort();
    }).toEqual([
      'Fixture Presentation 2 Manifest',
      'Fixture Presentation 3 Manifest',
    ]);
  } catch (error) {
    await testInfo.attach('service-worker-logs', {
      body: logs.join('\n') || '(no service worker logs)',
      contentType: 'text/plain',
    });
    throw error;
  } finally {
    if (context) await context.close();
    await firstFixture.close();
    await secondFixture.close();
    if (userDataDir) await fs.rm(userDataDir, { recursive: true, force: true });
  }
});

test('persists Mirador annotations in the selected workspace', async ({}, testInfo) => {
  const fixture = await createFixtureServer('belvedere-object.html', {
    pageHost: 'sammlung.belvedere.at',
    pagePath: '/objects/5686/unter-den-linden-abendlandschaft',
  });
  const logs = [];
  let context;
  let userDataDir;

  try {
    ({ context, userDataDir } = await launchExtensionContext());
    captureServiceWorkerLogs(context, logs);

    const extensionId = await getExtensionId(context);
    const manifestUrl = `${fixture.origin}/apis/iiif/presentation/v2/1-objects-5686/manifest`;
    const canvasId = `${fixture.origin}/apis/iiif/presentation/v2/1-objects-5686/canvas/18966`;

    await setLocalStorage(context, {
      annotationUserSettings: {
        displayName: 'Ada Annotator',
      },
    });

    await setWorkspaceState(context, {
      default: {
        annotations: {},
        id: 'default',
        items: {
          belvedere: {
            cors: true,
            error: false,
            id: manifestUrl,
            label: 'Belvedere Fixture Manifest',
            thumb: `${fixture.origin}/apis/iiif/image/v2/18966/full/%21100%2C100/0/default.jpg`,
            url: manifestUrl,
          },
        },
        name: 'default',
        updatedAt: new Date().toISOString(),
      },
      research: {
        annotations: {},
        id: 'research',
        items: {},
        name: 'Research',
        updatedAt: new Date().toISOString(),
      },
    });

    const miradorPage = await context.newPage();
    await miradorPage.goto(`chrome-extension://${extensionId}/miradorpage.html?workspace=default`);
    const annotationText = `Persistent workspace note ${'x'.repeat(10000)}`;

    await expect.poll(() => miradorPage.evaluate(() => ({
      hasAdapter: typeof window.detektIIIFCreateAnnotationAdapter === 'function',
      hasFlush: typeof window.detektIIIFFlushAnnotationWrites === 'function',
      hasMirador: Boolean(window.detektIIIFMirador),
      workspaceId: document.getElementById('Mirador-Container')?.dataset.workspaceId,
    })), { timeout: 20000 }).toEqual({
      hasAdapter: true,
      hasFlush: true,
      hasMirador: true,
      workspaceId: 'default',
    });

    const annotationId = await miradorPage.evaluate(async ({ annotationText, targetCanvasId }) => {
      const adapter = window.detektIIIFCreateAnnotationAdapter(targetCanvasId);
      const page = await adapter.create({
        body: {
          format: 'text/plain',
          type: 'TextualBody',
          value: annotationText,
        },
        motivation: 'commenting',
        target: targetCanvasId,
        type: 'Annotation',
      });

      return page.items[0].id;
    }, { annotationText, targetCanvasId: canvasId });

    expect(annotationId).toMatch(/^https:\/\/detektiiif\.net\/workspaces\/default\/annotations\/.+#/);

    await expect.poll(async () => {
      const state = await getWorkspaceState(context);
      const annotation = state.workspaces.default?.annotations?.[canvasId]?.[0];

      return {
        body: annotation?.body?.value,
        created: Boolean(annotation?.created),
        creationDate: Boolean(annotation?.creationDate),
        creator: annotation?.creator,
        modified: Boolean(annotation?.modified),
      };
    }).toEqual({
      body: annotationText,
      created: true,
      creationDate: true,
      creator: 'Ada Annotator',
      modified: true,
    });

    const syncStorage = await getRawSyncStorage(context);
    expect(syncStorage.workspaces).toBeUndefined();
    expect(syncStorage.workspaceIndex.workspaces.default.annotationsChunkCount).toBeGreaterThan(1);

    const rapidUpdateText = `Rapid workspace note ${'y'.repeat(10000)}`;
    const rapidUpdateWriteCount = await miradorPage.evaluate(async ({ annotationId, annotationText, targetCanvasId }) => {
      const originalRemove = chrome.storage.sync.remove;
      const originalSet = chrome.storage.sync.set;
      let writeCount = 0;

      chrome.storage.sync.remove = function patchedRemove(keys, callback) {
        writeCount += 1;
        return originalRemove.call(this, keys, callback);
      };
      chrome.storage.sync.set = function patchedSet(data, callback) {
        writeCount += 1;
        return originalSet.call(this, data, callback);
      };

      try {
        const adapter = window.detektIIIFCreateAnnotationAdapter(targetCanvasId);

        for (let index = 0; index < 30; index += 1) {
          await adapter.update({
            body: {
              format: 'text/plain',
              type: 'TextualBody',
              value: `${annotationText}-${index}`,
            },
            id: annotationId,
            motivation: 'commenting',
            target: targetCanvasId,
            type: 'Annotation',
          });
        }

        await window.detektIIIFFlushAnnotationWrites();
      } finally {
        chrome.storage.sync.remove = originalRemove;
        chrome.storage.sync.set = originalSet;
      }

      return writeCount;
    }, { annotationId, annotationText: rapidUpdateText, targetCanvasId: canvasId });

    expect(rapidUpdateWriteCount).toBeLessThanOrEqual(2);

    await expect.poll(async () => {
      const state = await getWorkspaceState(context);
      const annotation = state.workspaces.default?.annotations?.[canvasId]?.[0];

      return {
        body: annotation?.body?.value,
        creator: annotation?.creator,
        lastEditor: annotation?.lastEditor,
        lastSavedDate: Boolean(annotation?.lastSavedDate),
      };
    }).toEqual({
      body: `${rapidUpdateText}-29`,
      creator: 'Ada Annotator',
      lastEditor: 'Ada Annotator',
      lastSavedDate: true,
    });

    await setLocalStorage(context, {
      annotationUserSettings: {
        displayName: 'Grace Editor',
      },
    });
    await expect.poll(() => miradorPage.evaluate((targetCanvasId) => (
      window.detektIIIFCreateAnnotationAdapter(targetCanvasId).getStorageAdapterUser()
    ), canvasId)).toBe('Grace Editor');
    await miradorPage.evaluate(async ({ annotationId, targetCanvasId }) => {
      const adapter = window.detektIIIFCreateAnnotationAdapter(targetCanvasId);
      const annotation = await adapter.get(annotationId);

      await adapter.update({
        ...annotation,
        body: {
          format: 'text/plain',
          type: 'TextualBody',
          value: 'Edited by Grace',
        },
      });
      await window.detektIIIFFlushAnnotationWrites();
    }, { annotationId, targetCanvasId: canvasId });

    await expect.poll(async () => {
      const state = await getWorkspaceState(context);
      const annotation = state.workspaces.default?.annotations?.[canvasId]?.[0];

      return {
        body: annotation?.body?.value,
        creator: annotation?.creator,
        lastEditor: annotation?.lastEditor,
      };
    }).toEqual({
      body: 'Edited by Grace',
      creator: 'Ada Annotator',
      lastEditor: 'Grace Editor',
    });

    await miradorPage.reload();
    await expect.poll(() => miradorPage.evaluate(() => ({
      hasAdapter: typeof window.detektIIIFCreateAnnotationAdapter === 'function',
      workspaceId: document.getElementById('Mirador-Container')?.dataset.workspaceId,
    })), { timeout: 20000 }).toEqual({
      hasAdapter: true,
      workspaceId: 'default',
    });

    await expect.poll(() => miradorPage.evaluate(async ({ targetCanvasId }) => {
      const adapter = window.detektIIIFCreateAnnotationAdapter(targetCanvasId);
      const page = await adapter.all();
      return page.items.map((item) => item.body.value);
    }, { targetCanvasId: canvasId }), { timeout: 20000 }).toEqual([
      'Edited by Grace',
    ]);
  } catch (error) {
    await attachFailureDiagnostics(testInfo, fixture, logs, context);
    throw error;
  } finally {
    if (context) {
      await context.close();
    }
    await fixture.close();

    if (userDataDir) {
      await fs.rm(userDataDir, { recursive: true, force: true });
    }
  }
});

test('updates an open Mirador page when the active workspace changes', async ({}, testInfo) => {
  const logs = [];
  let context;
  let userDataDir;

  try {
    ({ context, userDataDir } = await launchExtensionContext());
    captureServiceWorkerLogs(context, logs);

    const extensionId = await getExtensionId(context);
    const timestamp = new Date().toISOString();
    await setWorkspaceState(context, {
      default: {
        annotations: {},
        id: 'default',
        items: {},
        name: 'default',
        updatedAt: timestamp,
      },
      research: {
        annotations: {},
        id: 'research',
        items: {},
        name: 'Research',
        updatedAt: timestamp,
      },
    });

    const miradorPage = await context.newPage();
    await miradorPage.goto(`chrome-extension://${extensionId}/miradorpage.html?workspace=default`);

    await expect.poll(() => miradorPage.evaluate(() => ({
      search: window.location.search,
      workspaceId: document.getElementById('Mirador-Container')?.dataset.workspaceId,
    })), { timeout: 20000 }).toEqual({
      search: '?workspace=default',
      workspaceId: 'default',
    });

    await setActiveWorkspaceInSyncStorage(context, 'research');

    await expect.poll(() => miradorPage.evaluate(() => ({
      search: window.location.search,
      workspaceId: document.getElementById('Mirador-Container')?.dataset.workspaceId,
    })), { timeout: 20000 }).toEqual({
      search: '?workspace=research',
      workspaceId: 'research',
    });

    const canvasId = 'https://example.org/iiif/canvas/workspace-switch';
    await miradorPage.evaluate(async ({ targetCanvasId }) => {
      const adapter = window.detektIIIFCreateAnnotationAdapter(targetCanvasId);
      await adapter.create({
        body: {
          format: 'text/plain',
          type: 'TextualBody',
          value: 'Annotation after workspace switch',
        },
        motivation: 'commenting',
        target: targetCanvasId,
        type: 'Annotation',
      });
      await window.detektIIIFFlushAnnotationWrites();
    }, { targetCanvasId: canvasId });

    await expect.poll(async () => {
      const state = await getWorkspaceState(context);

      return {
        defaultAnnotationCount: state.workspaces.default?.annotations?.[canvasId]?.length || 0,
        researchAnnotationText: state.workspaces.research?.annotations?.[canvasId]?.[0]?.body?.value,
      };
    }).toEqual({
      defaultAnnotationCount: 0,
      researchAnnotationText: 'Annotation after workspace switch',
    });
  } catch (error) {
    await testInfo.attach('service-worker-logs', {
      body: logs.join('\n') || '(no service worker logs)',
      contentType: 'text/plain',
    });
    throw error;
  } finally {
    if (context) {
      await context.close();
    }

    if (userDataDir) {
      await fs.rm(userDataDir, { recursive: true, force: true });
    }
  }
});

test('does not restore pending Mirador annotation writes after clearing a workspace', async ({}, testInfo) => {
  const logs = [];
  let context;
  let userDataDir;

  try {
    ({ context, userDataDir } = await launchExtensionContext());
    captureServiceWorkerLogs(context, logs);

    const extensionId = await getExtensionId(context);
    const timestamp = new Date().toISOString();
    await setWorkspaceState(context, {
      default: {
        annotations: {},
        annotationsUpdatedAt: timestamp,
        id: 'default',
        items: {
          fixture: {
            cors: true,
            error: false,
            id: 'https://example.org/iiif/manifest',
            label: 'Pending Annotation Fixture',
            thumb: 'https://example.org/thumb.jpg',
            url: 'https://example.org/iiif/manifest',
          },
        },
        itemsUpdatedAt: timestamp,
        name: 'default',
        updatedAt: timestamp,
      },
    });

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.getByRole('tab', { name: /^Workspaces/ }).click();

    const miradorPage = await context.newPage();
    await miradorPage.goto(`chrome-extension://${extensionId}/miradorpage.html?workspace=default`);

    await expect.poll(() => miradorPage.evaluate(() => ({
      hasAdapter: typeof window.detektIIIFCreateAnnotationAdapter === 'function',
      workspaceId: document.getElementById('Mirador-Container')?.dataset.workspaceId,
    })), { timeout: 20000 }).toEqual({
      hasAdapter: true,
      workspaceId: 'default',
    });

    const canvasId = 'https://example.org/iiif/canvas/pending-clear';
    const pendingTimerCount = await miradorPage.evaluate(async ({ targetCanvasId }) => {
      const originalTimers = {
        clearTimeout: window.clearTimeout.bind(window),
        setTimeout: window.setTimeout.bind(window),
      };
      const pendingAnnotationTimers = new Map();
      let nextTimerId = 9000;

      window.__detektIIIFPendingAnnotationTimers = pendingAnnotationTimers;
      window.__detektIIIFOriginalTimers = originalTimers;
      window.setTimeout = (handler, delay, ...args) => {
        if (delay === 750) {
          const timerId = nextTimerId;
          nextTimerId += 1;
          pendingAnnotationTimers.set(timerId, { args, handler });

          return timerId;
        }

        return originalTimers.setTimeout(handler, delay, ...args);
      };
      window.clearTimeout = (timerId) => {
        if (pendingAnnotationTimers.has(timerId)) {
          pendingAnnotationTimers.delete(timerId);

          return undefined;
        }

        return originalTimers.clearTimeout(timerId);
      };
      window.__detektIIIFFirePendingAnnotationTimers = async () => {
        const timers = Array.from(pendingAnnotationTimers.values());
        pendingAnnotationTimers.clear();
        timers.forEach(({ args, handler }) => {
          if (typeof handler === 'function') {
            handler(...args);
          }
        });
        await new Promise((resolve) => originalTimers.setTimeout(resolve, 0));

        return timers.length;
      };

      const adapter = window.detektIIIFCreateAnnotationAdapter(targetCanvasId);
      await adapter.create({
        body: {
          format: 'text/plain',
          type: 'TextualBody',
          value: 'Pending annotation should not return',
        },
        motivation: 'commenting',
        target: targetCanvasId,
        type: 'Annotation',
      });

      return pendingAnnotationTimers.size;
    }, { targetCanvasId: canvasId });

    expect(pendingTimerCount).toBe(1);

    await popup.getByRole('button', { name: 'Clear Workspace' }).click();
    await expect(popup.getByText('Remove all items and annotations from this workspace?')).toBeVisible();
    await popup.getByRole('button', { name: 'Yes' }).click();

    await expect.poll(() => miradorPage.evaluate(() => (
      window.__detektIIIFPendingAnnotationTimers?.size
    )), { timeout: 20000 }).toBe(0);

    const firedTimerCount = await miradorPage.evaluate(async () => (
      window.__detektIIIFFirePendingAnnotationTimers()
    ));
    expect(firedTimerCount).toBe(0);

    await expect.poll(async () => {
      const state = await getWorkspaceState(context);

      return {
        annotationCount: Object.keys(state.workspaces.default.annotations).length,
        itemCount: Object.keys(state.workspaces.default.items).length,
      };
    }).toEqual({
      annotationCount: 0,
      itemCount: 0,
    });

    await expect.poll(() => miradorPage.evaluate(async ({ targetCanvasId }) => {
      const adapter = window.detektIIIFCreateAnnotationAdapter(targetCanvasId);
      const page = await adapter.all();

      return page.items.length;
    }, { targetCanvasId: canvasId }), { timeout: 20000 }).toBe(0);
  } catch (error) {
    await testInfo.attach('service-worker-logs', {
      body: logs.join('\n') || '(no service worker logs)',
      contentType: 'text/plain',
    });
    throw error;
  } finally {
    if (context) {
      await context.close();
    }

    if (userDataDir) {
      await fs.rm(userDataDir, { recursive: true, force: true });
    }
  }
});

test('retries failed annotation writes and offers a manual retry', async ({}, testInfo) => {
  const logs = [];
  let context;
  let userDataDir;

  try {
    ({ context, userDataDir } = await launchExtensionContext());
    captureServiceWorkerLogs(context, logs);

    const extensionId = await getExtensionId(context);
    await setWorkspaceState(context, {
      default: {
        annotations: {},
        id: 'default',
        items: {},
        name: 'default',
        updatedAt: new Date().toISOString(),
      },
      research: {
        annotations: {},
        id: 'research',
        items: {},
        name: 'Research',
        updatedAt: new Date().toISOString(),
      },
    });

    const miradorPage = await context.newPage();
    await miradorPage.goto(`chrome-extension://${extensionId}/miradorpage.html?workspace=default`);
    await expect.poll(() => miradorPage.evaluate(() => (
      typeof window.detektIIIFCreateAnnotationAdapter === 'function'
    )), { timeout: 20000 }).toBe(true);

    const canvasId = 'https://example.org/iiif/canvas/retry';
    await miradorPage.evaluate(async (targetCanvasId) => {
      const originalSet = chrome.storage.sync.set;

      window.__detektIIIFRestoreSyncSet = () => {
        chrome.storage.sync.set = originalSet;
      };
      chrome.storage.sync.set = function failingSet(data, callback) {
        throw new Error('Fixture write failure');
      };

      const adapter = window.detektIIIFCreateAnnotationAdapter(targetCanvasId);
      await adapter.create({
        body: { format: 'text/plain', type: 'TextualBody', value: 'Retry me' },
        motivation: 'commenting',
        target: targetCanvasId,
        type: 'Annotation',
      });
    }, canvasId);

    const status = miradorPage.locator('#Annotation-Save-Status');
    await expect(status).toHaveAttribute('data-status', 'error', { timeout: 15000 });
    await expect(status).toContainText('Fixture write failure');
    await setActiveWorkspaceInSyncStorage(context, 'research');
    await expect.poll(() => miradorPage.evaluate(() => (
      document.getElementById('Mirador-Container')?.dataset.workspaceId
    ))).toBe('default');
    await miradorPage.evaluate(() => window.__detektIIIFRestoreSyncSet());
    await miradorPage.getByRole('button', { name: 'Retry' }).click();

    await expect.poll(async () => {
      const state = await getWorkspaceState(context);
      return state.workspaces.default.annotations?.[canvasId]?.[0]?.body?.value;
    }, { timeout: 20000 }).toBe('Retry me');
    await expect.poll(() => miradorPage.evaluate(() => (
      document.getElementById('Mirador-Container')?.dataset.workspaceId
    )), { timeout: 20000 }).toBe('research');
  } catch (error) {
    await testInfo.attach('service-worker-logs', {
      body: logs.join('\n') || '(no service worker logs)',
      contentType: 'text/plain',
    });
    throw error;
  } finally {
    if (context) await context.close();
    if (userDataDir) await fs.rm(userDataDir, { recursive: true, force: true });
  }
});

test('uses stable annotation ids and raw sources with GitHub storage', async ({}, testInfo) => {
  const logs = [];
  const githubWrites = [];
  let context;
  let userDataDir;

  try {
    ({ context, userDataDir } = await launchExtensionContext());
    captureServiceWorkerLogs(context, logs);

    await context.route('https://api.github.com/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());

      if (url.pathname === '/user') {
        await route.fulfill({
          contentType: 'application/json',
          json: {
            html_url: 'https://github.com/github-fixture-user',
            login: 'github-fixture-user',
          },
          status: 200,
        });
        return;
      }

      if (url.pathname === '/repos/seigedigital/detektiiif-workspaces') {
        await route.fulfill({
          contentType: 'application/json',
          json: {
            default_branch: 'main',
            full_name: 'seigedigital/detektiiif-workspaces',
            permissions: { push: true },
            private: false,
          },
          status: 200,
        });
        return;
      }

      if (request.method() === 'PUT') {
        const payload = request.postDataJSON();
        const pathName = decodeURIComponent(url.pathname.split('/contents/')[1] || '');
        const value = JSON.parse(Buffer.from(payload.content, 'base64').toString('utf8'));

        githubWrites.push({ path: pathName, value });
      }

      if (url.pathname.startsWith('/repos/seigedigital/detektiiif-workspaces/contents/')) {
        if (request.method() === 'GET') {
          await route.fulfill({
            contentType: 'application/json',
            json: { message: 'Not Found' },
            status: 404,
          });
          return;
        }

        await route.fulfill({
          contentType: 'application/json',
          json: {
            commit: { sha: 'fixture-commit' },
            content: { sha: 'fixture-content' },
          },
          status: 201,
        });
        return;
      }

      await route.fulfill({
        contentType: 'application/json',
        json: { message: 'Not Found' },
        status: 404,
      });
    });

    const extensionId = await getExtensionId(context);
    await setLocalStorage(context, {
      workspaceStorageSettings: {
        backend: 'github',
        github: {
          owner: 'seigedigital',
          repo: 'detektiiif-workspaces',
          token: 'github_pat_fixture',
        },
      },
    });

    const miradorPage = await context.newPage();
    await miradorPage.goto(`chrome-extension://${extensionId}/miradorpage.html?workspace=default`);

    await expect.poll(() => miradorPage.evaluate(() => ({
      hasAdapter: typeof window.detektIIIFCreateAnnotationAdapter === 'function',
      workspaceId: document.getElementById('Mirador-Container')?.dataset.workspaceId,
    })), { timeout: 20000 }).toEqual({
      hasAdapter: true,
      workspaceId: 'default',
    });

    const canvasId = 'https://example.org/iiif/canvas/1';
    const result = await miradorPage.evaluate(async ({ targetCanvasId }) => {
      const adapter = window.detektIIIFCreateAnnotationAdapter(targetCanvasId);
      const page = await adapter.create({
        body: {
          format: 'text/plain',
          type: 'TextualBody',
          value: 'GitHub raw id note',
        },
        motivation: 'commenting',
        target: targetCanvasId,
        type: 'Annotation',
      });

      return {
        annotationId: page.items[0].id,
        creator: page.items[0].creator,
        pageId: page.id,
      };
    }, { targetCanvasId: canvasId });

    expect(result.pageId).toMatch(
      /^https:\/\/detektiiif\.net\/workspaces\/[0-9a-f-]+\/annotations\/[0-9a-f-]+$/
    );
    expect(result.annotationId).toMatch(
      new RegExp(`^${result.pageId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}#.+`)
    );

    await miradorPage.evaluate(async ({ targetCanvasId }) => {
      const adapter = window.detektIIIFCreateAnnotationAdapter(targetCanvasId);

      for (let index = 0; index < 3; index += 1) {
        await adapter.create({
          body: {
            format: 'text/plain',
            type: 'TextualBody',
            value: `${index}:${'x'.repeat(300000)}`,
          },
          motivation: 'commenting',
          target: targetCanvasId,
          type: 'Annotation',
        });
      }
    }, { targetCanvasId: canvasId });

    await miradorPage.evaluate(() => window.detektIIIFFlushAnnotationWrites());

    const annotationWrites = githubWrites.filter((write) => write.value.type === 'AnnotationPage');
    const annotationWrite = annotationWrites[0];
    expect(annotationWrites.length).toBeGreaterThan(1);
    expect(annotationWrites.every((write) => (
      Buffer.byteLength(`${JSON.stringify(write.value, null, 2)}\n`) < 900 * 1024
    ))).toBe(true);
    expect(annotationWrite.value.id).toBe(result.pageId);
    expect(annotationWrite.value.items[0].id).toBe(result.annotationId);
    expect(annotationWrite.value.items[0].creator).toBe('github-fixture-user');
    expect(annotationWrite.value.seeAlso[0].id).toMatch(
      /^https:\/\/raw\.githubusercontent\.com\/seigedigital\/detektiiif-workspaces\/main\/revisions\/[0-9a-f-]+\/annotations\/.+\/0001\.json$/
    );
    expect(result.creator).toBe('github-fixture-user');
  } catch (error) {
    await testInfo.attach('service-worker-logs', {
      body: logs.join('\n') || '(no service worker logs)',
      contentType: 'text/plain',
    });
    throw error;
  } finally {
    if (context) {
      await context.close();
    }

    if (userDataDir) {
      await fs.rm(userDataDir, { recursive: true, force: true });
    }
  }
});

test('keeps the published GitHub workspace intact when a revision upload fails', async ({}, testInfo) => {
  const owner = 'atomic-fixture';
  const repo = 'workspace';
  const timestamp = new Date().toISOString();
  const originalMetadata = {
    annotations: {},
    annotationsUpdatedAt: timestamp,
    generatedBy: 'detektIIIF',
    id: `https://github.com/${owner}/${repo}/tree/main`,
    itemsPath: 'items.json',
    itemsUpdatedAt: timestamp,
    name: 'Atomic fixture',
    type: 'detektIIIF:Workspace',
    updatedAt: timestamp,
    version: 1,
    workspaceId: 'default',
  };
  const files = new Map([
    ['items.json', {
      sha: 'sha-items',
      value: {
        manifest: {
          id: 'manifest',
          label: 'Published manifest',
          type: 'manifest',
          url: 'https://example.org/manifest.json',
        },
      },
    }],
    ['workspace.json', { sha: 'sha-workspace', value: originalMetadata }],
  ]);
  let revisionWriteAttempts = 0;
  let rootWriteAttempts = 0;
  let context;
  let userDataDir;

  try {
    ({ context, userDataDir } = await launchExtensionContext());
    await context.route('https://api.github.com/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());

      if (url.pathname === '/user') {
        await route.fulfill({ contentType: 'application/json', json: { login: owner }, status: 200 });
        return;
      }

      if (url.pathname === `/repos/${owner}/${repo}`) {
        await route.fulfill({
          contentType: 'application/json',
          json: {
            default_branch: 'main',
            full_name: `${owner}/${repo}`,
            permissions: { push: true },
            private: true,
          },
          status: 200,
        });
        return;
      }

      const prefix = `/repos/${owner}/${repo}/contents/`;
      if (url.pathname.startsWith(prefix)) {
        const pathName = decodeURIComponent(url.pathname.slice(prefix.length));

        if (request.method() === 'GET') {
          const file = files.get(pathName);
          if (!file) {
            await route.fulfill({ contentType: 'application/json', json: { message: 'Not Found' }, status: 404 });
            return;
          }
          await route.fulfill({
            contentType: 'application/json',
            json: {
              content: Buffer.from(`${JSON.stringify(file.value, null, 2)}\n`).toString('base64'),
              sha: file.sha,
              type: 'file',
            },
            status: 200,
          });
          return;
        }

        if (request.method() === 'PUT' && pathName.startsWith('revisions/')) {
          revisionWriteAttempts += 1;
          await route.fulfill({
            contentType: 'application/json',
            json: { message: 'Fixture upload failure' },
            status: 500,
          });
          return;
        }

        if (request.method() === 'PUT' && pathName === 'workspace.json') {
          rootWriteAttempts += 1;
        }
      }

      await route.fulfill({ contentType: 'application/json', json: { message: 'Unsupported' }, status: 400 });
    });

    const extensionId = await getExtensionId(context);
    await setLocalStorage(context, {
      workspaceStorageSettings: {
        backend: 'github',
        github: { owner, repo, token: 'github_pat_fixture' },
      },
    });
    const miradorPage = await context.newPage();
    await miradorPage.goto(`chrome-extension://${extensionId}/miradorpage.html?workspace=default`);
    await expect.poll(() => miradorPage.evaluate(() => (
      typeof window.detektIIIFCreateAnnotationAdapter === 'function'
    )), { timeout: 20000 }).toBe(true);

    const failed = await miradorPage.evaluate(async () => {
      const canvasId = 'https://example.org/canvas/atomic';
      const adapter = window.detektIIIFCreateAnnotationAdapter(canvasId);
      await adapter.create({
        body: { format: 'text/plain', type: 'TextualBody', value: 'Unpublished note' },
        motivation: 'commenting',
        target: canvasId,
        type: 'Annotation',
      });

      try {
        await window.detektIIIFFlushAnnotationWrites();
        return false;
      } catch {
        return true;
      }
    });

    expect(failed).toBe(true);
    expect(revisionWriteAttempts).toBeGreaterThan(0);
    expect(rootWriteAttempts).toBe(0);
    expect(files.get('workspace.json')).toEqual({
      sha: 'sha-workspace',
      value: originalMetadata,
    });
  } finally {
    if (context) await context.close();
    if (userDataDir) await fs.rm(userDataDir, { recursive: true, force: true });
  }
});

test('merges GitHub annotations and isolates repository caches', async ({}, testInfo) => {
  const logs = [];
  const owner = 'collaboration-fixture';
  const canvasId = 'https://example.org/iiif/canvas/shared';
  const repositories = ['workspace-alpha', 'workspace-beta'];
  const files = new Map();
  let shaCounter = 0;
  let delayedRepository = '';
  let delayedRepositoryReads = 0;
  let injectConcurrentWorkspaceWrite = false;
  let concurrentWorkspaceWriteInjected = false;
  let context;
  let userDataDir;

  function fileKey(repo, path) {
    return `${repo}:${path}`;
  }

  function setFile(repo, path, value) {
    shaCounter += 1;
    files.set(fileKey(repo, path), { sha: `sha-${shaCounter}`, value });
  }

  function getFile(repo, path) {
    return files.get(fileKey(repo, path));
  }

  function getStoredCanvasPage(repo, targetCanvasId) {
    const workspace = getFile(repo, 'workspace.json').value;

    if (Array.isArray(workspace.annotationIndexFiles)) {
      const annotationIndex = Object.assign({}, ...workspace.annotationIndexFiles.map((file) => (
        getFile(repo, file.path).value
      )));
      const pages = annotationIndex[targetCanvasId]?.pages || [];
      const items = pages.flatMap((page) => getFile(repo, page.path).value.items || []);

      return { items };
    }

    return getFile(repo, workspace.annotations[targetCanvasId].path).value;
  }

  function createAnnotation(id, value) {
    return {
      body: { format: 'text/plain', type: 'TextualBody', value },
      id,
      motivation: 'commenting',
      target: canvasId,
      type: 'Annotation',
    };
  }

  function initializeRepository(repo, annotationId, annotationText) {
    const timestamp = new Date().toISOString();
    const annotationPath = 'annotations/shared.json';
    setFile(repo, annotationPath, {
      id: `https://raw.githubusercontent.com/${owner}/${repo}/main/${annotationPath}`,
      items: [createAnnotation(annotationId, annotationText)],
      target: canvasId,
      type: 'AnnotationPage',
    });
    setFile(repo, 'workspace.json', {
      annotations: {
        [canvasId]: { path: annotationPath, updatedAt: timestamp },
      },
      annotationsUpdatedAt: timestamp,
      generatedBy: 'detektIIIF',
      id: `https://github.com/${owner}/${repo}/tree/main`,
      itemsPath: null,
      itemsUpdatedAt: timestamp,
      name: repo,
      type: 'detektIIIF:Workspace',
      updatedAt: timestamp,
      version: 1,
      workspaceId: 'default',
    });
  }

  initializeRepository('workspace-alpha', 'https://example.org/annotations/alpha-1', 'Alpha one');
  initializeRepository('workspace-beta', 'https://example.org/annotations/beta-1', 'Beta one');

  try {
    ({ context, userDataDir } = await launchExtensionContext());
    captureServiceWorkerLogs(context, logs);

    await context.route('https://api.github.com/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());

      if (url.pathname === '/user') {
        await route.fulfill({
          contentType: 'application/json',
          json: { login: 'collaboration-user' },
          status: 200,
        });
        return;
      }

      const match = url.pathname.match(/^\/repos\/([^/]+)\/([^/]+)(?:\/contents\/(.*))?$/);
      if (!match || decodeURIComponent(match[1]) !== owner || !repositories.includes(decodeURIComponent(match[2]))) {
        await route.fulfill({ contentType: 'application/json', json: { message: 'Not Found' }, status: 404 });
        return;
      }

      const repo = decodeURIComponent(match[2]);
      const pathName = match[3] ? decodeURIComponent(match[3]) : '';
      if (!pathName) {
        await route.fulfill({
          contentType: 'application/json',
          json: {
            default_branch: 'main',
            full_name: `${owner}/${repo}`,
            permissions: { push: true },
            private: true,
          },
          status: 200,
        });
        return;
      }

      if (request.method() === 'GET') {
        if (repo === delayedRepository && pathName === 'workspace.json') {
          delayedRepositoryReads += 1;
          await new Promise((resolve) => setTimeout(resolve, 750));
        }
        const file = getFile(repo, pathName);
        if (!file) {
          await route.fulfill({ contentType: 'application/json', json: { message: 'Not Found' }, status: 404 });
          return;
        }
        await route.fulfill({
          contentType: 'application/json',
          json: {
            content: Buffer.from(`${JSON.stringify(file.value, null, 2)}\n`).toString('base64'),
            sha: file.sha,
            type: 'file',
          },
          status: 200,
        });
        return;
      }

      if (request.method() === 'PUT') {
        const payload = request.postDataJSON();
        const value = JSON.parse(Buffer.from(payload.content, 'base64').toString('utf8'));

        if (
          repo === 'workspace-alpha' &&
          pathName === 'workspace.json' &&
          injectConcurrentWorkspaceWrite &&
          !concurrentWorkspaceWriteInjected
        ) {
          const currentMetadata = getFile(repo, pathName).value;
          const currentAnnotationPath = currentMetadata.annotations[canvasId].path;
          const currentPage = getFile(repo, currentAnnotationPath).value;

          currentPage.items.push(createAnnotation(
            'https://example.org/annotations/alpha-during-write',
            'Alpha during write'
          ));
          setFile(repo, currentAnnotationPath, currentPage);
          setFile(repo, pathName, {
            ...currentMetadata,
            annotationsUpdatedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
          concurrentWorkspaceWriteInjected = true;
        }

        const existing = getFile(repo, pathName);
        const hasShaConflict = (
          (existing && payload.sha !== existing.sha) ||
          (!existing && payload.sha)
        );
        if (hasShaConflict) {
          await route.fulfill({
            contentType: 'application/json',
            json: { message: 'The file changed while it was being updated.' },
            status: 409,
          });
          return;
        }

        setFile(repo, pathName, value);
        await route.fulfill({
          contentType: 'application/json',
          json: { commit: { sha: `commit-${shaCounter}` }, content: { sha: getFile(repo, pathName).sha } },
          status: 200,
        });
        return;
      }

      if (request.method() === 'DELETE') {
        files.delete(fileKey(repo, pathName));
        await route.fulfill({ status: 204 });
        return;
      }

      await route.fulfill({ contentType: 'application/json', json: { message: 'Unsupported' }, status: 400 });
    });

    const extensionId = await getExtensionId(context);
    const createSettings = (repo) => ({
      backend: 'github',
      github: { owner, repo, token: 'github_pat_fixture' },
    });
    await setLocalStorage(context, { workspaceStorageSettings: createSettings('workspace-alpha') });

    const miradorPage = await context.newPage();
    await miradorPage.goto(`chrome-extension://${extensionId}/miradorpage.html?workspace=default`);
    await expect.poll(() => miradorPage.evaluate(async (targetCanvasId) => {
      const page = await window.detektIIIFCreateAnnotationAdapter?.(targetCanvasId).all();
      return page?.items.map((item) => item.body.value);
    }, canvasId), { timeout: 20000 }).toEqual(['Alpha one']);

    delayedRepository = 'workspace-beta';
    await setLocalStorage(context, { workspaceStorageSettings: createSettings('workspace-beta') });
    await expect.poll(() => delayedRepositoryReads).toBeGreaterThan(0);
    await setLocalStorage(context, { workspaceStorageSettings: createSettings('workspace-alpha') });
    await expect.poll(() => miradorPage.evaluate(async (targetCanvasId) => {
      const page = await window.detektIIIFCreateAnnotationAdapter?.(targetCanvasId).all();
      return page?.items.map((item) => item.body.value);
    }, canvasId), { timeout: 20000 }).toEqual(['Alpha one']);
    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(await miradorPage.evaluate(async (targetCanvasId) => {
      const page = await window.detektIIIFCreateAnnotationAdapter(targetCanvasId).all();
      return page.items.map((item) => item.body.value);
    }, canvasId)).toEqual(['Alpha one']);
    delayedRepository = '';

    const alphaMetadata = getFile('workspace-alpha', 'workspace.json').value;
    const alphaPath = alphaMetadata.annotations[canvasId].path;
    const alphaPage = getFile('workspace-alpha', alphaPath).value;
    alphaPage.items.push(createAnnotation('https://example.org/annotations/alpha-2', 'Alpha two'));
    setFile('workspace-alpha', alphaPath, alphaPage);
    setFile('workspace-alpha', 'workspace.json', {
      ...alphaMetadata,
      annotationsUpdatedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    injectConcurrentWorkspaceWrite = true;

    await miradorPage.evaluate(async (targetCanvasId) => {
      const adapter = window.detektIIIFCreateAnnotationAdapter(targetCanvasId);
      await adapter.create({
        body: { format: 'text/plain', type: 'TextualBody', value: 'Alpha local' },
        motivation: 'commenting',
        target: targetCanvasId,
        type: 'Annotation',
      });
      await window.detektIIIFFlushAnnotationWrites();
    }, canvasId);

    let storedPage = getStoredCanvasPage('workspace-alpha', canvasId);
    expect(storedPage.items.map((item) => item.body.value).sort()).toEqual([
      'Alpha during write',
      'Alpha local',
      'Alpha one',
      'Alpha two',
    ]);

    await setLocalStorage(context, { workspaceStorageSettings: createSettings('workspace-beta') });
    await expect.poll(() => miradorPage.evaluate(async (targetCanvasId) => {
      const page = await window.detektIIIFCreateAnnotationAdapter(targetCanvasId).all();
      return page.items.map((item) => item.body.value);
    }, canvasId), { timeout: 20000 }).toEqual(['Beta one']);

    await miradorPage.evaluate(async (targetCanvasId) => {
      const adapter = window.detektIIIFCreateAnnotationAdapter(targetCanvasId);
      await adapter.create({
        body: { format: 'text/plain', type: 'TextualBody', value: 'Beta local' },
        motivation: 'commenting',
        target: targetCanvasId,
        type: 'Annotation',
      });
      await window.detektIIIFFlushAnnotationWrites();
    }, canvasId);

    const betaPage = getStoredCanvasPage('workspace-beta', canvasId);
    expect(betaPage.items.map((item) => item.body.value).sort()).toEqual(['Beta local', 'Beta one']);
    expect(getStoredCanvasPage('workspace-alpha', canvasId)
      .items.map((item) => item.body.value)).not.toContain('Beta local');
  } catch (error) {
    await testInfo.attach('service-worker-logs', {
      body: logs.join('\n') || '(no service worker logs)',
      contentType: 'text/plain',
    });
    throw error;
  } finally {
    if (context) await context.close();
    if (userDataDir) await fs.rm(userDataDir, { recursive: true, force: true });
  }
});

test('clears GitHub workspace item and annotation files', async ({}, testInfo) => {
  const logs = [];
  const githubDeletes = [];
  const githubWrites = [];
  let context;
  let userDataDir;

  const timestamp = new Date().toISOString();
  const canvasId = 'https://example.org/iiif/canvas/github-clear';
  const itemsPath = 'items.json';
  const annotationPath = 'annotations/github-clear.json';
  const rawAnnotationPageUrl = `https://raw.githubusercontent.com/seigedigital/detektiiif-workspaces/main/${annotationPath}`;
  const registry = {
    generatedBy: 'detektIIIF',
    type: 'detektIIIF:WorkspaceRegistry',
    updatedAt: timestamp,
    version: 1,
    workspaces: [{
      owner: 'seigedigital',
      repo: 'detektiiif-workspaces',
      workspaceId: 'default',
    }],
  };
  const githubFiles = new Map(Object.entries({
    'workspace.json': {
      annotations: {
        [canvasId]: {
          id: rawAnnotationPageUrl,
          itemCount: 1,
          path: annotationPath,
          updatedAt: timestamp,
        },
      },
      annotationsUpdatedAt: timestamp,
      generatedBy: 'detektIIIF',
      id: 'https://github.com/seigedigital/detektiiif-workspaces/tree/main',
      itemsPath,
      itemsUpdatedAt: timestamp,
      name: 'default',
      type: 'detektIIIF:Workspace',
      updatedAt: timestamp,
      version: 1,
      workspaceId: 'default',
    },
    [itemsPath]: {
      fixture: {
        cors: true,
        error: false,
        id: 'https://example.org/iiif/manifest',
        label: 'GitHub Clear Fixture Manifest',
        thumb: 'https://example.org/thumb.jpg',
        url: 'https://example.org/iiif/manifest',
      },
    },
    [annotationPath]: {
      '@context': 'http://www.w3.org/ns/anno.jsonld',
      id: rawAnnotationPageUrl,
      items: [{
        body: {
          format: 'text/plain',
          type: 'TextualBody',
          value: 'GitHub annotation should be deleted',
        },
        id: `${rawAnnotationPageUrl}#annotation-1`,
        motivation: 'commenting',
        target: canvasId,
        type: 'Annotation',
      }],
      target: canvasId,
      type: 'AnnotationPage',
    },
  }));

  try {
    ({ context, userDataDir } = await launchExtensionContext());
    captureServiceWorkerLogs(context, logs);

    await context.route('https://api.github.com/user', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        json: {
          html_url: 'https://github.com/seigedigital',
          login: 'seigedigital',
        },
        status: 200,
      });
    });

    await context.route('https://api.github.com/repos/seigedigital/detektiiif-workspace-registry**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());

      if (url.pathname === '/repos/seigedigital/detektiiif-workspace-registry') {
        await route.fulfill({
          contentType: 'application/json',
          json: {
            default_branch: 'main',
            full_name: 'seigedigital/detektiiif-workspace-registry',
            name: 'detektiiif-workspace-registry',
            owner: { login: 'seigedigital' },
            permissions: { push: true },
            private: true,
          },
          status: 200,
        });
        return;
      }

      if (url.pathname === '/repos/seigedigital/detektiiif-workspace-registry/contents/registry.json') {
        if (request.method() === 'GET') {
          await route.fulfill({
            contentType: 'application/json',
            json: {
              content: Buffer.from(`${JSON.stringify(registry, null, 2)}\n`).toString('base64'),
              sha: 'sha-registry',
              type: 'file',
            },
            status: 200,
          });
          return;
        }

        if (request.method() === 'PUT') {
          await route.fulfill({
            contentType: 'application/json',
            json: {
              commit: { sha: 'fixture-registry-commit' },
              content: { sha: 'sha-registry' },
            },
            status: 200,
          });
          return;
        }
      }

      await route.fulfill({
        contentType: 'application/json',
        json: { message: 'Not Found' },
        status: 404,
      });
    });

    await context.route('https://api.github.com/repos/seigedigital/detektiiif-workspaces**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());

      if (url.pathname === '/repos/seigedigital/detektiiif-workspaces') {
        await route.fulfill({
          contentType: 'application/json',
          json: {
            default_branch: 'main',
            full_name: 'seigedigital/detektiiif-workspaces',
            permissions: { push: true },
            private: false,
          },
          status: 200,
        });
        return;
      }

      if (url.pathname.startsWith('/repos/seigedigital/detektiiif-workspaces/contents/')) {
        const pathName = decodeURIComponent(url.pathname.split('/contents/')[1] || '');

        if (request.method() === 'GET') {
          if (!githubFiles.has(pathName)) {
            await route.fulfill({
              contentType: 'application/json',
              json: { message: 'Not Found' },
              status: 404,
            });
            return;
          }

          await route.fulfill({
            contentType: 'application/json',
            json: {
              content: Buffer.from(`${JSON.stringify(githubFiles.get(pathName), null, 2)}\n`).toString('base64'),
              sha: `sha-${pathName}`,
              type: 'file',
            },
            status: 200,
          });
          return;
        }

        if (request.method() === 'PUT') {
          if (request.method() !== 'PUT') {
            await route.fulfill({
              contentType: 'application/json',
              json: { message: 'Not Found' },
              status: 404,
            });
            return;
          }

          if (request.method() !== 'PUT') {
            await route.fulfill({
              contentType: 'application/json',
              json: { message: 'Not Found' },
              status: 404,
            });
            return;
          }

          const payload = request.postDataJSON();
          const value = JSON.parse(Buffer.from(payload.content, 'base64').toString('utf8'));

          githubFiles.set(pathName, value);
          githubWrites.push({ path: pathName, value });
          await route.fulfill({
            contentType: 'application/json',
            json: {
              commit: { sha: 'fixture-commit' },
              content: { sha: `sha-${pathName}` },
            },
            status: 200,
          });
          return;
        }

        if (request.method() === 'DELETE') {
          githubFiles.delete(pathName);
          githubDeletes.push(pathName);
          await route.fulfill({
            contentType: 'application/json',
            json: { commit: { sha: 'fixture-delete' } },
            status: 200,
          });
          return;
        }
      }

      await route.fulfill({
        contentType: 'application/json',
        json: { message: 'Not Found' },
        status: 404,
      });
    });

    const extensionId = await getExtensionId(context);
    await setLocalStorage(context, {
      workspaceStorageSettings: {
        backend: 'github',
        github: {
          owner: 'seigedigital',
          repo: 'detektiiif-workspaces',
          token: 'github_pat_fixture',
        },
      },
    });

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.getByRole('tab', { name: /^Workspaces/ }).click();
    await expect(popup.getByText('GitHub Clear Fixture Manifest')).toBeVisible();

    await popup.getByRole('button', { name: 'Clear Workspace' }).click();
    await expect(popup.getByText('Remove all items and annotations from this workspace?')).toBeVisible();
    await popup.getByRole('button', { name: 'Yes' }).click();

    await expect.poll(() => githubDeletes.slice().sort()).toEqual([
      annotationPath,
      itemsPath,
    ].sort());

    const workspaceWrite = githubWrites.filter((write) => write.path === 'workspace.json').slice(-1)[0];
    expect(workspaceWrite.value.annotationIndexFiles).toEqual([]);
    expect(workspaceWrite.value.itemFiles).toEqual([]);
    expect(workspaceWrite.value.version).toBe(3);
  } catch (error) {
    await testInfo.attach('service-worker-logs', {
      body: logs.join('\n') || '(no service worker logs)',
      contentType: 'text/plain',
    });
    throw error;
  } finally {
    if (context) {
      await context.close();
    }

    if (userDataDir) {
      await fs.rm(userDataDir, { recursive: true, force: true });
    }
  }
});

test('configures workspace storage backends from the options page', async ({}, testInfo) => {
  const logs = [];
  let context;
  let userDataDir;

  try {
    ({ context, userDataDir } = await launchExtensionContext());
    captureServiceWorkerLogs(context, logs);

    const extensionId = await getExtensionId(context);
    const optionsPage = await context.newPage();
    await optionsPage.goto(`chrome-extension://${extensionId}/options.html`);

    const backendSelect = optionsPage.getByRole('combobox', { name: 'Storage Backend' });

    await backendSelect.click();
    await optionsPage.getByRole('option', { name: 'GitHub Storage' }).click();
    await optionsPage.getByLabel('Annotation display name').fill('Ada Annotator');
    await optionsPage.getByLabel('Personal access token').fill('github_pat_fixture');
    await optionsPage.getByRole('button', { name: 'Save Storage Settings' }).click();

    await expect(optionsPage.getByText('Workspace storage settings saved.')).toBeVisible();

    const localStorage = await getRawLocalStorage(context);
    expect(localStorage.workspaceStorageSettings).toMatchObject({
      backend: 'github',
      github: {
        owner: '',
        repo: '',
        token: 'github_pat_fixture',
      },
    });
    expect(localStorage.annotationUserSettings).toEqual({
      displayName: 'Ada Annotator',
    });
  } catch (error) {
    await testInfo.attach('service-worker-logs', {
      body: logs.join('\n') || '(no service worker logs)',
      contentType: 'text/plain',
    });
    throw error;
  } finally {
    if (context) {
      await context.close();
    }

    if (userDataDir) {
      await fs.rm(userDataDir, { recursive: true, force: true });
    }
  }
});

test('opens public GitHub workspaces without a PAT as read-only', async ({}, testInfo) => {
  const logs = [];
  let context;
  let userDataDir;
  const timestamp = new Date().toISOString();
  const repositorySlug = 'shared-course/public-workspace';
  const workspace = {
    annotations: {},
    annotationsUpdatedAt: timestamp,
    generatedBy: 'detektIIIF',
    id: `https://github.com/${repositorySlug}/tree/main`,
    itemsPath: null,
    itemsUpdatedAt: timestamp,
    name: 'Public Course Workspace',
    type: 'detektIIIF:Workspace',
    updatedAt: timestamp,
    version: 1,
    workspaceId: 'default',
  };

  try {
    ({ context, userDataDir } = await launchExtensionContext());
    captureServiceWorkerLogs(context, logs);

    await context.route('https://api.github.com/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());

      if (url.pathname === `/repos/${repositorySlug}` && request.method() === 'GET') {
        await route.fulfill({
          contentType: 'application/json',
          json: {
            default_branch: 'main',
            full_name: repositorySlug,
            html_url: `https://github.com/${repositorySlug}`,
            name: 'public-workspace',
            owner: { login: 'shared-course' },
            private: false,
          },
          status: 200,
        });
        return;
      }

      if (
        url.pathname === `/repos/${repositorySlug}/contents/workspace.json` &&
        request.method() === 'GET'
      ) {
        await route.fulfill({
          contentType: 'application/json',
          json: {
            content: Buffer.from(`${JSON.stringify(workspace, null, 2)}\n`).toString('base64'),
            sha: 'sha-public-workspace',
            type: 'file',
          },
          status: 200,
        });
        return;
      }

      await route.fulfill({
        contentType: 'application/json',
        json: { message: 'Not Found' },
        status: 404,
      });
    });

    const extensionId = await getExtensionId(context);
    await setLocalStorage(context, {
      workspaceStorageSettings: {
        backend: 'github',
        github: { owner: '', repo: '', token: '' },
      },
    });

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.getByRole('tab', { name: /^Workspaces/ }).click();
    await popup.getByRole('button', { name: 'Open shared workspace' }).click();
    const openDialog = popup.getByRole('dialog', { name: 'Open shared workspace' });
    await openDialog.getByLabel('GitHub repository').fill(`https://github.com/${repositorySlug}`);
    await openDialog.getByRole('button', { name: 'Open' }).click();

    await expect(popup.getByText('Public Course Workspace workspace is empty.')).toBeVisible();
    await expect(popup.getByText(/^Read-only GitHub workspace/)).toBeVisible();
    await expect(popup.getByRole('button', { name: 'Clear Workspace' })).toBeDisabled();

    await popup.getByRole('button', { name: 'Share workspace' }).click();
    const shareDialog = popup.getByRole('dialog', { name: 'Share workspace' });
    await expect(shareDialog.getByRole('textbox', { name: 'Workspace link' })).toHaveValue(
      `https://github.com/${repositorySlug}`
    );
    await expect(shareDialog.getByText(/Repository administrators can/)).toBeVisible();
    await shareDialog.getByRole('button', { name: 'Close' }).click();

    const miradorPage = await context.newPage();
    await miradorPage.goto(`chrome-extension://${extensionId}/miradorpage.html?workspace=default`);
    await expect.poll(() => miradorPage.evaluate(() => (
      typeof window.detektIIIFCreateAnnotationAdapter === 'function'
    )), { timeout: 20000 }).toBe(true);

    const mutationError = await miradorPage.evaluate(async () => {
      const adapter = window.detektIIIFCreateAnnotationAdapter('https://example.org/canvas/public');

      try {
        await adapter.create({ id: 'temporary', type: 'Annotation' });
        return '';
      } catch (error) {
        return error.message;
      }
    });
    expect(mutationError).toBe('This workspace is read-only.');
  } catch (error) {
    await testInfo.attach('service-worker-logs', {
      body: logs.join('\n') || '(no service worker logs)',
      contentType: 'text/plain',
    });
    throw error;
  } finally {
    if (context) {
      await context.close();
    }

    if (userDataDir) {
      await fs.rm(userDataDir, { recursive: true, force: true });
    }
  }
});

test('manages GitHub workspace repositories from the popup', async ({}, testInfo) => {
  const logs = [];
  const createdRepositories = [];
  const deletedRepositories = [];
  const renamedRepositories = [];
  const collaboratorChanges = [];
  const collaborators = [{
    html_url: 'https://github.com/course-viewer',
    login: 'course-viewer',
    permissions: { pull: true, push: false },
    role_name: 'read',
  }];
  const invitations = [];
  let userRepoListRequests = 0;
  const userRepoListRequestUrls = [];
  let context;
  let userDataDir;
  const timestamp = new Date().toISOString();
  const registrySlug = 'seigedigital/detektiiif-workspace-registry';
  const registryFiles = new Map([['registry.json', {
    generatedBy: 'detektIIIF',
    type: 'detektIIIF:WorkspaceRegistry',
    updatedAt: timestamp,
    version: 1,
    workspaces: [{
      owner: 'seigedigital',
      repo: 'detektiiif-existing',
      workspaceId: 'default',
    }, {
      owner: 'seigedigital',
      repo: 'not-detektiiif',
      workspaceId: 'default',
    }],
  }]]);
  const registryWrites = [];
  const repositories = new Map([
    ['seigedigital/detektiiif-existing', {
      default_branch: 'main',
      full_name: 'seigedigital/detektiiif-existing',
      html_url: 'https://github.com/seigedigital/detektiiif-existing',
      name: 'detektiiif-existing',
      owner: { login: 'seigedigital' },
      permissions: { admin: true, push: true },
      private: true,
      updated_at: timestamp,
    }],
    ['seigedigital/not-detektiiif', {
      default_branch: 'main',
      full_name: 'seigedigital/not-detektiiif',
      html_url: 'https://github.com/seigedigital/not-detektiiif',
      name: 'not-detektiiif',
      owner: { login: 'seigedigital' },
      permissions: { admin: true, push: true },
      private: true,
      updated_at: timestamp,
    }],
    ['seigedigital/empty-existing', {
      default_branch: 'main',
      full_name: 'seigedigital/empty-existing',
      html_url: 'https://github.com/seigedigital/empty-existing',
      name: 'empty-existing',
      owner: { login: 'seigedigital' },
      permissions: { admin: true, push: true },
      private: true,
      updated_at: timestamp,
    }],
  ]);
  const workspaceFiles = new Map([
    ['seigedigital/detektiiif-existing', {
      annotations: {},
      annotationsUpdatedAt: timestamp,
      generatedBy: 'detektIIIF',
      id: 'https://github.com/seigedigital/detektiiif-existing/tree/main',
      itemsPath: null,
      itemsUpdatedAt: timestamp,
      name: 'detektiiif-existing',
      type: 'detektIIIF:Workspace',
      updatedAt: timestamp,
      version: 1,
      workspaceId: 'default',
    }],
    ['seigedigital/not-detektiiif', {
      generatedBy: 'someone-else',
      type: 'Other',
    }],
  ]);

  function getRepositorySlugFromPath(pathname) {
    const parts = pathname.split('/').filter(Boolean);

    return parts.length >= 3 && parts[0] === 'repos'
      ? `${parts[1]}/${parts[2]}`
      : '';
  }

  function createRepositoryResponse(owner, name, overrides = {}) {
    return {
      default_branch: 'main',
      full_name: `${owner}/${name}`,
      html_url: `https://github.com/${owner}/${name}`,
      name,
      owner: { login: owner },
      permissions: { admin: true, push: true },
      private: true,
      updated_at: timestamp,
      ...overrides,
    };
  }

  try {
    ({ context, userDataDir } = await launchExtensionContext());
    captureServiceWorkerLogs(context, logs);

    await context.route('https://api.github.com/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());

      if (url.pathname === '/user') {
        await route.fulfill({
          contentType: 'application/json',
          json: {
            html_url: 'https://github.com/seigedigital',
            login: 'seigedigital',
          },
          status: 200,
        });
        return;
      }

      if (url.pathname === '/user/repos' && request.method() === 'GET') {
        userRepoListRequests += 1;
        userRepoListRequestUrls.push(request.url());
        await route.fulfill({
          contentType: 'application/json',
          json: Array.from(repositories.values()),
          status: 200,
        });
        return;
      }

      if (url.pathname.startsWith('/repos/seigedigital/detektiiif-workspace-registry')) {
        if (url.pathname === `/repos/${registrySlug}`) {
          await route.fulfill({
            contentType: 'application/json',
            json: createRepositoryResponse('seigedigital', 'detektiiif-workspace-registry'),
            status: 200,
          });
          return;
        }

        if (url.pathname === `/repos/${registrySlug}/contents/registry.json`) {
          if (request.method() === 'GET') {
            await route.fulfill({
              contentType: 'application/json',
              json: {
                content: Buffer.from(`${JSON.stringify(registryFiles.get('registry.json'), null, 2)}\n`).toString('base64'),
                sha: 'sha-registry',
                type: 'file',
              },
              status: 200,
            });
            return;
          }

          if (request.method() === 'PUT') {
            const payload = request.postDataJSON();
            const value = JSON.parse(Buffer.from(payload.content, 'base64').toString('utf8'));

            registryFiles.set('registry.json', value);
            registryWrites.push(value);
            await route.fulfill({
              contentType: 'application/json',
              json: {
                commit: { sha: 'fixture-registry-commit' },
                content: { sha: 'sha-registry' },
              },
              status: 200,
            });
            return;
          }
        }

        await route.fulfill({
          contentType: 'application/json',
          json: { message: 'Not Found' },
          status: 404,
        });
        return;
      }

      if (url.pathname === '/user/repos' && request.method() === 'POST') {
        const payload = request.postDataJSON();
        const repository = createRepositoryResponse('seigedigital', payload.name, {
          private: payload.private,
        });

        repositories.set(repository.full_name, repository);
        createdRepositories.push(payload);
        await route.fulfill({
          contentType: 'application/json',
          json: repository,
          status: 201,
        });
        return;
      }

      const repositorySlug = getRepositorySlugFromPath(url.pathname);

      if (repositorySlug && repositories.has(repositorySlug)) {
        if (url.pathname === `/repos/${repositorySlug}/collaborators`) {
          await route.fulfill({
            contentType: 'application/json',
            json: collaborators,
            status: 200,
          });
          return;
        }

        if (url.pathname.startsWith(`/repos/${repositorySlug}/collaborators/`)) {
          const username = decodeURIComponent(url.pathname.split('/').pop());

          if (request.method() === 'PUT') {
            const payload = request.postDataJSON();
            const invitation = {
              created_at: timestamp,
              html_url: `https://github.com/${repositorySlug}/invitations`,
              id: 73,
              invitee: { login: username },
              permissions: payload.permission,
            };

            invitations.push(invitation);
            collaboratorChanges.push({ action: 'invite', permission: payload.permission, username });
            await route.fulfill({ contentType: 'application/json', json: invitation, status: 201 });
            return;
          }

          if (request.method() === 'DELETE') {
            const index = collaborators.findIndex((item) => item.login === username);
            if (index >= 0) collaborators.splice(index, 1);
            collaboratorChanges.push({ action: 'remove', username });
            await route.fulfill({ status: 204 });
            return;
          }
        }

        if (url.pathname === `/repos/${repositorySlug}/invitations`) {
          await route.fulfill({
            contentType: 'application/json',
            json: invitations,
            status: 200,
          });
          return;
        }

        if (url.pathname.startsWith(`/repos/${repositorySlug}/invitations/`)) {
          const invitationId = Number(url.pathname.split('/').pop());
          const index = invitations.findIndex((item) => item.id === invitationId);
          const invitation = index >= 0 ? invitations.splice(index, 1)[0] : null;

          collaboratorChanges.push({
            action: 'cancel',
            username: invitation?.invitee?.login || '',
          });
          await route.fulfill({ status: 204 });
          return;
        }

        if (url.pathname.endsWith('/contents/workspace.json')) {
          if (request.method() === 'GET') {
            if (!workspaceFiles.has(repositorySlug)) {
              await route.fulfill({
                contentType: 'application/json',
                json: { message: 'Not Found' },
                status: 404,
              });
              return;
            }

            await route.fulfill({
              contentType: 'application/json',
              json: {
                content: Buffer.from(`${JSON.stringify(workspaceFiles.get(repositorySlug), null, 2)}\n`).toString('base64'),
                sha: `sha-${repositorySlug}`,
                type: 'file',
              },
              status: 200,
            });
            return;
          }

          if (request.method() !== 'PUT') {
            await route.fulfill({
              contentType: 'application/json',
              json: { message: 'Not Found' },
              status: 404,
            });
            return;
          }

          const payload = request.postDataJSON();
          const value = JSON.parse(Buffer.from(payload.content, 'base64').toString('utf8'));

          workspaceFiles.set(repositorySlug, value);
          await route.fulfill({
            contentType: 'application/json',
            json: {
              commit: { sha: 'fixture-commit' },
              content: { sha: `sha-${repositorySlug}` },
            },
            status: 200,
          });
          return;
        }

        if (request.method() === 'GET') {
          await route.fulfill({
            contentType: 'application/json',
            json: repositories.get(repositorySlug),
            status: 200,
          });
          return;
        }

        if (request.method() === 'PATCH') {
          const payload = request.postDataJSON();

          if (typeof payload.private === 'boolean') {
            const repository = {
              ...repositories.get(repositorySlug),
              private: payload.private,
            };

            repositories.set(repositorySlug, repository);
            await route.fulfill({
              contentType: 'application/json',
              json: repository,
              status: 200,
            });
            return;
          }

          const [owner] = repositorySlug.split('/');
          const renamedSlug = `${owner}/${payload.name}`;
          const renamedRepository = createRepositoryResponse(owner, payload.name);
          const workspaceFile = workspaceFiles.get(repositorySlug);

          repositories.delete(repositorySlug);
          workspaceFiles.delete(repositorySlug);
          repositories.set(renamedSlug, renamedRepository);
          workspaceFiles.set(renamedSlug, workspaceFile);
          renamedRepositories.push({ from: repositorySlug, to: renamedSlug });
          await route.fulfill({
            contentType: 'application/json',
            json: renamedRepository,
            status: 200,
          });
          return;
        }

        if (request.method() === 'DELETE') {
          repositories.delete(repositorySlug);
          workspaceFiles.delete(repositorySlug);
          deletedRepositories.push(repositorySlug);
          await route.fulfill({ status: 204 });
          return;
        }
      }

      await route.fulfill({
        contentType: 'application/json',
        json: { message: 'Not Found' },
        status: 404,
      });
    });

    const extensionId = await getExtensionId(context);
    await setLocalStorage(context, {
      workspaceStorageSettings: {
        backend: 'github',
        github: {
          owner: 'seigedigital',
          repo: 'not-detektiiif',
          token: 'github_pat_fixture',
        },
      },
    });

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(popup.getByRole('dialog', { name: 'Workspace could not be loaded' })).toBeVisible();
    await popup.getByRole('button', { name: 'OK' }).click();
    await popup.getByRole('tab', { name: /^Workspaces/ }).click();

    const workspaceSelect = popup.getByRole('combobox', { name: 'Workspace' });
    await workspaceSelect.click();
    await expect(popup.getByRole('option', { name: 'seigedigital/detektiiif-existing' })).toBeVisible();
    await expect(popup.getByRole('option', { name: 'seigedigital/not-detektiiif' })).toHaveCount(0);
    await popup.getByRole('option', { name: 'seigedigital/detektiiif-existing' }).click();

    await expect.poll(async () => {
      const localStorage = await getRawLocalStorage(context);

      return localStorage.workspaceStorageSettings.github;
    }).toMatchObject({
      owner: 'seigedigital',
      repo: 'detektiiif-existing',
      token: 'github_pat_fixture',
    });

    await popup.getByRole('button', { name: 'Share workspace' }).click();
    const shareDialog = popup.getByRole('dialog', { name: 'Share workspace' });
    await expect(shareDialog).toBeVisible();
    await expect(shareDialog.getByRole('textbox', { name: 'Workspace link' })).toHaveValue(
      'https://github.com/seigedigital/detektiiif-existing'
    );
    await expect(shareDialog.getByText('course-viewer')).toBeVisible();

    await shareDialog.getByRole('combobox', { name: 'Visibility' }).click();
    popup.once('dialog', (dialog) => dialog.accept());
    await popup.getByRole('option', { name: /^Public/ }).click();
    await expect(shareDialog.getByText('Public', { exact: true })).toBeVisible();
    expect(repositories.get('seigedigital/detektiiif-existing').private).toBe(false);

    await shareDialog.getByLabel('GitHub username').fill('new-student');
    await shareDialog.getByRole('combobox', { name: 'Role' }).click();
    await popup.getByRole('option', { name: 'Viewer' }).click();
    await shareDialog.getByRole('button', { name: 'Invite collaborator' }).click();
    await expect(shareDialog.getByText('new-student')).toBeVisible();
    await expect(shareDialog.getByText('Pending Viewer')).toBeVisible();

    popup.once('dialog', (dialog) => dialog.accept());
    await shareDialog.getByRole('button', { name: 'Remove course-viewer' }).click();
    await expect(shareDialog.getByText('course-viewer')).toHaveCount(0);

    popup.once('dialog', (dialog) => dialog.accept());
    await shareDialog.getByRole('button', { name: 'Cancel invitation for new-student' }).click();
    await expect(shareDialog.getByText('new-student')).toHaveCount(0);
    await shareDialog.getByRole('button', { name: 'Close' }).click();

    expect(collaboratorChanges).toEqual([
      { action: 'invite', permission: 'pull', username: 'new-student' },
      { action: 'remove', username: 'course-viewer' },
      { action: 'cancel', username: 'new-student' },
    ]);

    popup.once('dialog', (dialog) => dialog.accept('empty-existing'));
    await popup.getByRole('button', { name: 'Create workspace' }).click();

    await expect.poll(() => workspaceFiles.has('seigedigital/empty-existing')).toBe(true);
    await expect.poll(async () => {
      const localStorage = await getRawLocalStorage(context);

      return localStorage.workspaceStorageSettings.github;
    }).toMatchObject({
      owner: 'seigedigital',
      repo: 'empty-existing',
      token: 'github_pat_fixture',
    });

    popup.once('dialog', (dialog) => dialog.accept('detektiiif-workspace-new'));
    await popup.getByRole('button', { name: 'Create workspace' }).click();

    await expect.poll(() => createdRepositories).toEqual([{
      auto_init: true,
      name: 'detektiiif-workspace-new',
      private: true,
    }]);
    await expect.poll(async () => {
      const localStorage = await getRawLocalStorage(context);

      return localStorage.workspaceStorageSettings.github;
    }).toMatchObject({
      owner: 'seigedigital',
      repo: 'detektiiif-workspace-new',
      token: 'github_pat_fixture',
    });

    const stableWorkspaceId = workspaceFiles.get(
      'seigedigital/detektiiif-workspace-new'
    ).id;
    expect(stableWorkspaceId).toMatch(
      /^https:\/\/detektiiif\.net\/workspaces\/[0-9a-f-]+$/
    );

    popup.once('dialog', (dialog) => dialog.accept('detektiiif-workspace-renamed'));
    await popup.getByRole('button', { name: 'Rename workspace' }).click();

    await expect.poll(() => renamedRepositories).toEqual([{
      from: 'seigedigital/detektiiif-workspace-new',
      to: 'seigedigital/detektiiif-workspace-renamed',
    }]);
    await expect.poll(async () => {
      const localStorage = await getRawLocalStorage(context);

      return localStorage.workspaceStorageSettings.github;
    }).toMatchObject({
      owner: 'seigedigital',
      repo: 'detektiiif-workspace-renamed',
      token: 'github_pat_fixture',
    });
    expect(workspaceFiles.get('seigedigital/detektiiif-workspace-renamed')).toMatchObject({
      id: stableWorkspaceId,
      repository: 'https://github.com/seigedigital/detektiiif-workspace-renamed/tree/main',
      version: 3,
    });

    popup.once('dialog', (dialog) => dialog.accept());
    await popup.getByRole('button', { name: 'Delete workspace' }).click();

    await expect.poll(() => deletedRepositories).toEqual(['seigedigital/detektiiif-workspace-renamed']);
    await expect.poll(async () => {
      const localStorage = await getRawLocalStorage(context);

      return localStorage.workspaceStorageSettings.github;
    }).toMatchObject({
      owner: '',
      repo: '',
      token: 'github_pat_fixture',
    });
    await expect.poll(() => registryFiles.get('registry.json').workspaces).toEqual([{
      owner: 'seigedigital',
      repo: 'detektiiif-existing',
      workspaceId: 'default',
    }, {
      owner: 'seigedigital',
      repo: 'empty-existing',
      workspaceId: 'default',
    }, {
      owner: 'seigedigital',
      repo: 'not-detektiiif',
      workspaceId: 'default',
    }]);
    expect(registryWrites.length).toBeGreaterThan(0);
    expect(userRepoListRequests).toBe(0);
    expect(userRepoListRequestUrls).toEqual([]);
  } catch (error) {
    await testInfo.attach('service-worker-logs', {
      body: logs.join('\n') || '(no service worker logs)',
      contentType: 'text/plain',
    });
    throw error;
  } finally {
    if (context) {
      await context.close();
    }

    if (userDataDir) {
      await fs.rm(userDataDir, { recursive: true, force: true });
    }
  }
});
