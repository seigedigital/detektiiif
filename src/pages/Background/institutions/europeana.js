export default {
  name: 'Europeana / SMK',
  getUrlsFromPageUrl(pageUrl) {
    const url = parseUrl(pageUrl)
    if (!url || url.hostname !== 'www.europeana.eu') {
      return []
    }

    const match = url.pathname.match(/^\/[^/]+\/item\/2020903\/(.+)/)
    if (!match) {
      return []
    }

    return [`https://api.smk.dk/api/v1/iiif/manifest/?id=${match[1]}`]
  }
}

function parseUrl(value) {
  try {
    return new URL(value)
  } catch {
    return null
  }
}
