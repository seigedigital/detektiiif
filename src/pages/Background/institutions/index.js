import archiveOrg from './archiveOrg'
import belvedere from './belvedere'
import eManuscripta from './eManuscripta'
import eRara from './eRara'
import europeana from './europeana'
import nationalMuseumSE from './nationalMuseumSE'

const institutionRules = [
  archiveOrg,
  belvedere,
  eManuscripta,
  eRara,
  europeana,
  nationalMuseumSE
]

export function getInstitutionUrlsFromPageUrl(pageUrl) {
  return collectUrls((rule) => rule.getUrlsFromPageUrl?.(pageUrl))
}

export function getInstitutionUrlsFromJSON(body, sourceUrl) {
  return collectUrls((rule) => rule.getUrlsFromJSON?.(body, sourceUrl))
}

export function shouldInstitutionFetchBodyAfterHead(url, status) {
  return institutionRules.some((rule) => (
    rule.shouldFetchBodyAfterHead?.(url, status) === true
  ))
}

function collectUrls(callback) {
  const urls = []
  const seen = new Set()

  for (const rule of institutionRules) {
    for (const url of callback(rule) || []) {
      if (url && !seen.has(url)) {
        urls.push(url)
        seen.add(url)
      }
    }
  }

  return urls
}
