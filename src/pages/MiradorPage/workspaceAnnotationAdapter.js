import {
  getCanvasAnnotations,
  saveCanvasAnnotations,
} from '../../shared/workspaces'

function createAnnotationId(workspaceId, canvasId) {
  const cryptoApi = globalThis.crypto
  const suffix = cryptoApi && typeof cryptoApi.randomUUID === 'function'
    ? cryptoApi.randomUUID()
    : `${Date.now()}-${Math.random()}`

  return `detektiiif://workspaces/${workspaceId}/annotations/${encodeURIComponent(canvasId)}/${suffix}`
}

class WorkspaceAnnotationAdapter {
  constructor(workspaceId, canvasId, user = 'detektIIIF User') {
    this.workspaceId = workspaceId
    this.canvasId = canvasId
    this.user = user
    this.annotationPageId = `detektiiif://workspaces/${workspaceId}/annotations/${encodeURIComponent(canvasId)}`
  }

  getStorageAdapterUser() {
    return this.user
  }

  async all() {
    const items = await getCanvasAnnotations(this.workspaceId, this.canvasId)

    return {
      id: this.annotationPageId,
      type: 'AnnotationPage',
      items,
    }
  }

  async create(annotation) {
    const page = await this.all()
    const nextAnnotation = {
      ...annotation,
      id: annotation.id || createAnnotationId(this.workspaceId, this.canvasId),
    }
    const items = [...page.items, nextAnnotation]

    await saveCanvasAnnotations(this.workspaceId, this.canvasId, items)

    return {
      ...page,
      items,
    }
  }

  async update(annotation) {
    const page = await this.all()
    const items = [...page.items]
    const index = items.findIndex((item) => item.id === annotation.id)

    if (index >= 0) {
      items.splice(index, 1, annotation)
    } else {
      items.push(annotation)
    }

    await saveCanvasAnnotations(this.workspaceId, this.canvasId, items)

    return {
      ...page,
      items,
    }
  }

  async delete(annotationId) {
    const page = await this.all()
    const items = page.items.filter((item) => item.id !== annotationId)

    await saveCanvasAnnotations(this.workspaceId, this.canvasId, items)

    return {
      ...page,
      items,
    }
  }

  async get(annotationId) {
    const page = await this.all()

    return page.items.find((item) => item.id === annotationId) || null
  }
}

export default WorkspaceAnnotationAdapter
