/*global chrome*/
import Mirador from 'mirador';
import annotationPlugins from 'mirador-annotation-editor';
import 'mirador-annotation-editor/dist/index.css';

import {
  DEFAULT_WORKSPACE_ID,
  getActiveWorkspace,
  loadWorkspaceState,
} from '../../shared/workspaces'
import WorkspaceAnnotationAdapter from './workspaceAnnotationAdapter'
import './style.css'

let miradorInstance = null
let renderTimer = null

function getRequestedWorkspaceId() {
  const params = new URLSearchParams(window.location.search)

  return params.get('workspace')
}

function getWorkspaceForPage(workspaces, activeWorkspaceId) {
  const requestedWorkspaceId = getRequestedWorkspaceId()

  if (requestedWorkspaceId && workspaces[requestedWorkspaceId]) {
    return workspaces[requestedWorkspaceId]
  }

  return getActiveWorkspace(workspaces, activeWorkspaceId)
}

function getManifestItems(workspace) {
  return Object.values(workspace.items || {})
    .filter((item) => item && item.url)
}

function buildMiradorConfig(workspace) {
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
    'detektIIIF User'
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
      readonly: false,
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

async function renderMirador() {
  const { workspaces, activeWorkspaceId } = await loadWorkspaceState()
  const workspace = getWorkspaceForPage(workspaces, activeWorkspaceId)
  const container = document.getElementById('Mirador-Container')

  if (!container) {
    return
  }

  unmountMirador()
  container.innerHTML = ''
  container.dataset.workspaceId = workspace.id || DEFAULT_WORKSPACE_ID
  miradorInstance = Mirador.viewer(buildMiradorConfig(workspace), annotationPlugins)
  window.detektIIIFMirador = miradorInstance
}

function scheduleMiradorRender() {
  if (renderTimer) {
    window.clearTimeout(renderTimer)
  }

  renderTimer = window.setTimeout(() => {
    renderTimer = null
    renderMirador()
  }, 100)
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'sync') {
    return
  }

  if (changes.workspaces || changes.activeWorkspaceId) {
    scheduleMiradorRender()
  }
})

renderMirador()
