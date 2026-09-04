export default {
  name: 'Nationalmuseum Sweden',
  getUrlsFromPageUrl(pageUrl) {
    const url = parseUrl(pageUrl)
    if (!url || url.hostname !== 'nationalmuseumse.iiifhosting.com') {
      return []
    }

    const match = url.pathname.match(/^\/iiif\/([^/]+)\//)
    if (!match) {
      return []
    }

    return [`https://nationalmuseumse.iiifhosting.com/iiif/${match[1]}/manifest.json`]
  }
}

function parseUrl(value) {
  try {
    return new URL(value)
  } catch {
    return null
  }
}
