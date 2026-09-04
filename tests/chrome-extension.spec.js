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
    await sendTextFixture(
      req,
      res,
      resourceFixture,
      origin,
      'application/json; charset=utf-8'
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
      '--host-resolver-rules=MAP sammlung.belvedere.at 127.0.0.1',
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

async function getWorkspaceState(context) {
  const worker = await getServiceWorker(context);

  return worker.evaluate(() => (
    new Promise((resolve) => {
      chrome.storage.sync.get(['workspaces', 'activeWorkspaceId'], (result) => {
        resolve({
          activeWorkspaceId: result.activeWorkspaceId || null,
          workspaces: result.workspaces || {},
        });
      });
    })
  ));
}

async function setWorkspaceState(context, workspaces, activeWorkspaceId = 'default') {
  const worker = await getServiceWorker(context);

  return worker.evaluate(
    ({ nextWorkspaces, nextActiveWorkspaceId }) => (
      new Promise((resolve) => {
        chrome.storage.sync.set({
          activeWorkspaceId: nextActiveWorkspaceId,
          workspaces: nextWorkspaces,
        }, resolve);
      })
    ),
    {
      nextActiveWorkspaceId: activeWorkspaceId,
      nextWorkspaces: workspaces,
    }
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
    });

    const miradorPage = await context.newPage();
    await miradorPage.goto(`chrome-extension://${extensionId}/miradorpage.html?workspace=default`);

    await expect.poll(() => miradorPage.evaluate(() => ({
      hasAdapter: typeof window.detektIIIFCreateAnnotationAdapter === 'function',
      hasMirador: Boolean(window.detektIIIFMirador),
      workspaceId: document.getElementById('Mirador-Container')?.dataset.workspaceId,
    })), { timeout: 20000 }).toEqual({
      hasAdapter: true,
      hasMirador: true,
      workspaceId: 'default',
    });

    await miradorPage.evaluate(async ({ targetCanvasId }) => {
      const adapter = window.detektIIIFCreateAnnotationAdapter(targetCanvasId);
      await adapter.create({
        body: {
          format: 'text/plain',
          type: 'TextualBody',
          value: 'Persistent workspace note',
        },
        id: 'annotation-1',
        motivation: 'commenting',
        target: targetCanvasId,
        type: 'Annotation',
      });
    }, { targetCanvasId: canvasId });

    await expect.poll(async () => {
      const state = await getWorkspaceState(context);
      return state.workspaces.default.annotations[canvasId][0].body.value;
    }).toBe('Persistent workspace note');

    await miradorPage.reload();
    await expect.poll(() => miradorPage.evaluate(async ({ targetCanvasId }) => {
      const adapter = window.detektIIIFCreateAnnotationAdapter(targetCanvasId);
      const page = await adapter.all();
      return page.items.map((item) => item.body.value);
    }, { targetCanvasId: canvasId }), { timeout: 20000 }).toEqual([
      'Persistent workspace note',
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
