export default {
  name: 'archive.org',
  getUrlsFromPageUrl(pageUrl) {
    const url = parseUrl(pageUrl)
    if (!url || url.hostname !== 'archive.org') {
      return []
    }

    const match = url.pathname.match(/^\/details\/([^/]+)/)
    if (!match) {
      return []
    }

    return [`https://iiif.archive.org/iiif/${match[1]}/manifest.json`]
  }
}

function parseUrl(value) {
  try {
    return new URL(value)
  } catch {
    return null
  }
}
