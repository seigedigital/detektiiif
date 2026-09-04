export default {
  name: 'Belvedere',
  getUrlsFromPageUrl(pageUrl) {
    const object = getBelvedereObject(pageUrl)
    if (!object) {
      return []
    }

    return [
      getObjectJsonUrl(object),
      getManifestUrl(object)
    ]
  },
  getUrlsFromJSON(body, sourceUrl) {
    const object = getBelvedereObject(sourceUrl)
    if (!object) {
      return []
    }

    const records = Array.isArray(body?.object) ? body.object : []
    const urls = [getManifestUrl(object)]

    for (const record of records) {
      addFieldUrl(urls, record?.iiifManifest)
      addBelvedereImageUrls(urls, object, record?.primaryMedia)
      addBelvedereImageUrls(urls, object, record?.media)
    }

    return unique(urls)
  }
}

function getBelvedereObject(pageUrl) {
  const url = parseUrl(pageUrl)
  if (!url || url.hostname !== 'sammlung.belvedere.at') {
    return null
  }

  const match = url.pathname.match(/^\/objects\/(\d+)(?:\/|$)/)
  if (!match) {
    return null
  }

  return {
    id: match[1],
    origin: url.origin
  }
}

function getObjectJsonUrl(object) {
  return `${object.origin}/objects/${object.id}/json`
}

function getManifestUrl(object) {
  return `${object.origin}/apis/iiif/presentation/v2/1-objects-${object.id}/manifest`
}

function addFieldUrl(urls, field) {
  for (const value of getFieldValues(field)) {
    if (typeof value === 'string' && value.startsWith('http')) {
      urls.push(value)
    }
  }
}

function addBelvedereImageUrls(urls, object, field) {
  for (const value of getFieldValues(field)) {
    const match = String(value).match(/\/internal\/media\/dispatcher\/(\d+)\//)
    if (match) {
      urls.push(`${object.origin}/apis/iiif/image/v2/${match[1]}/info.json`)
    }
  }
}

function getFieldValues(field) {
  const value = field?.value

  if (Array.isArray(value)) {
    return value
  }

  if (value === undefined || value === null) {
    return []
  }

  return [value]
}

function unique(urls) {
  return Array.from(new Set(urls.filter(Boolean)))
}

function parseUrl(value) {
  try {
    return new URL(value)
  } catch {
    return null
  }
}
