const FALLBACK_THUMBNAIL = 'logo-small-grey.png'
const GENERIC_THUMBNAIL = 'logo-small.png'
const IIIF_CONTEXT_PATTERN = /^https?:\/\/iiif\.io\/api\/([^/]+)\/([^/]+)\/context\.json$/i
const SHARED_CANVAS_CONTEXT = 'http://www.shared-canvas.org/ns/context.json'

export function analyzeIIIFResource(body) {
  if (!body || typeof body !== 'object' || !body.hasOwnProperty('@context')) {
    return false
  }

  const context = getIIIFContext(body['@context'])

  if (context === SHARED_CANVAS_CONTEXT) {
    return {
      api: 'presentation',
      type: getIIIFType(body['@type'] || body.type),
      version: 2
    }
  }

  const match = context?.match(IIIF_CONTEXT_PATTERN)
  if (!match) {
    return false
  }

  return {
    api: match[1].toLowerCase(),
    type: getIIIFType(body['@type'] || body.type),
    version: getMajorVersion(match[2])
  }
}

export function buildIIIFItem(data, url, iiif, cors) {
  const item = {
    id: getResourceId(data, url),
    url,
    cors,
    error: 0,
    version: iiif.version
  }

  if (iiif.api === 'presentation' && iiif.type === 'manifest') {
    try {
      item.label = getLabel(data, item.id)
      item.thumb = getManifestThumbnail(data, iiif.version)
    } catch {
      item.error = 1
      item.label = url
      item.thumb = FALLBACK_THUMBNAIL
    }
    return item
  }

  if (iiif.type === 'collection') {
    item.label = getLabel(data, item.id)
    item.thumb = GENERIC_THUMBNAIL
    return item
  }

  if (iiif.api === 'image') {
    item.label = url
    item.thumb = getImageThumbnail(data, iiif.version) || FALLBACK_THUMBNAIL
    return item
  }

  item.label = url
  item.thumb = GENERIC_THUMBNAIL
  return item
}

export function getIIIFStorageKey(iiif) {
  if (iiif.type === 'manifest') {
    return 'manifests'
  }

  if (iiif.type === 'collection') {
    return 'collections'
  }

  return 'images'
}

export function getLabel(data, fallback) {
  const label = data?.label

  if (typeof label === 'string' || label instanceof String) {
    return label
  }

  if (Array.isArray(label)) {
    const firstValue = label.find((item) => (
      item && typeof item === 'object' && '@value' in item
    ))
    if (firstValue) {
      return firstValue['@value']
    }

    const firstString = label.find((item) => typeof item === 'string')
    if (firstString) {
      return firstString
    }
  }

  if (label && typeof label === 'object') {
    if (Array.isArray(label.en) && label.en[0]) {
      return label.en[0]
    }

    if (Array.isArray(label.none) && label.none[0]) {
      return label.none[0]
    }

    const firstLanguage = Object.keys(label).find((key) => (
      Array.isArray(label[key]) && label[key][0]
    ))
    if (firstLanguage) {
      return label[firstLanguage][0]
    }
  }

  return fallback
}

export function getResourceId(data, fallback) {
  return data?.['@id'] || data?.id || fallback
}

export function v2GetManifestThumbnail(manifest) {
  if (manifest && 'thumbnail' in manifest) {
    return getStringOrId(manifest.thumbnail)
  }

  const canvas = manifest?.sequences?.[0]?.canvases?.[0]
  const resource = canvas?.images?.[0]?.resource

  if (canvas && 'thumbnail' in canvas) {
    return getStringOrId(canvas.thumbnail)
  }

  const serviceId = getServiceId(resource?.service)
  if (serviceId) {
    return serviceId + '/full/,100/0/default.jpg'
  }

  return resource?.['@id'] || resource?.id || null
}

export function v3GetManifestThumbnail(manifest) {
  return v3AndV4GetManifestThumbnail(manifest)
}

export function v4GetManifestThumbnail(manifest) {
  return v3AndV4GetManifestThumbnail(manifest)
}

function v3AndV4GetManifestThumbnail(manifest) {
  if (manifest && 'thumbnail' in manifest) {
    return getStringOrId(manifest.thumbnail)
  }

  if (manifest?.items?.[0] && 'thumbnail' in manifest.items[0]) {
    return getStringOrId(manifest.items[0].thumbnail)
  }

  const firstAnnotationPage = manifest?.items?.[0]?.items?.[0]
  if (firstAnnotationPage && 'thumbnail' in firstAnnotationPage) {
    return getStringOrId(firstAnnotationPage.thumbnail)
  }

  const body = firstAnnotationPage?.items?.[0]?.body
  const serviceId = getServiceId(body?.service)
  if (serviceId) {
    return serviceId + '/full/,100/0/default.jpg'
  }

  return body?.id || body?.['@id'] || null
}

function getIIIFContext(context) {
  const contexts = Array.isArray(context) ? context : [context]

  return contexts.slice().reverse().find((item) => (
    typeof item === 'string' &&
    (
      item === SHARED_CANVAS_CONTEXT ||
      IIIF_CONTEXT_PATTERN.test(item)
    )
  ))
}

function getMajorVersion(version) {
  const major = parseInt(version, 10)

  if (Number.isNaN(major)) {
    return version.toLowerCase()
  }

  return major
}

function getIIIFType(type) {
  if (!type) {
    return false
  }

  const firstType = Array.isArray(type) ? type[0] : type

  if (typeof firstType !== 'string') {
    return false
  }

  const parts = firstType.split(':')
  return parts[parts.length - 1].toLowerCase()
}

function getManifestThumbnail(data, version) {
  switch (version) {
    case 2:
      return v2GetManifestThumbnail(data)
    case 3:
      return v3GetManifestThumbnail(data)
    case 4:
      return v4GetManifestThumbnail(data)
    default:
      return FALLBACK_THUMBNAIL
  }
}

function getImageThumbnail(data, version) {
  const id = version === 3
    ? data?.id
    : data?.['@id'] || data?.id

  if (!id) {
    return null
  }

  return id + '/full/100,/0/default.jpg'
}

function getStringOrId(value) {
  if (value === undefined || value === null) {
    return null
  }

  if (typeof value === 'string' || value instanceof String) {
    return value
  }

  if (Array.isArray(value)) {
    return getStringOrId(value[0])
  }

  if (typeof value === 'object') {
    return value['@id'] || value.id || null
  }

  return null
}

function getServiceId(service) {
  if (!service) {
    return null
  }

  const firstService = Array.isArray(service) ? service[0] : service
  return firstService?.['@id'] || firstService?.id || null
}
