import {
  getInstitutionUrlsFromJSON,
  getInstitutionUrlsFromPageUrl,
  shouldInstitutionFetchBodyAfterHead
} from '../institutions'

const MAX_URLS_PER_RULE = 19

const HTML_DISCOVERY_RULES = [
  {
    name: 'semantic-link',
    pattern: /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>[\s\S]*?\b(?:iiif|i3f|manifest)\b[\s\S]*?<\/a>/gi,
    getUrl: (match) => match[1]
  },
  {
    name: 'html-attribute',
    pattern: /(?:href|src|data-[\w-]+)\s*=\s*["']([^"']*(?:iiif|i3f|manifest)[^"']*)["']/gi,
    getUrl: (match) => match[1]
  },
  {
    name: 'generic',
    pattern: /https?:\/\/[^"<\s]*(iiif|i3f|manifest)[^"<\s]*/gi,
    getUrl: (match) => match[0],
    reject: (url) => /\.jpg(?:[?#].*)?$/i.test(url)
  },
  {
    name: 'encoded-query',
    pattern: /http[^"<\s]*=(https?:\/\/[^"&<]*(iiif|i3f|manifest)[^"&<]*)/gi,
    getUrl: (match) => match[1]
  },
  {
    name: 'json',
    pattern: /(https?:\/\/[^" <>\s]*(iiif|i3f|manifest)[^" <>\s]*\.json)/gi,
    getUrl: (match) => match[1]
  },
  {
    name: 'image-api',
    pattern: /(https?:\/\/[^">]+\/)[maxful0-9,!]+\/[maxful0-9,!]+\/[0-9!]{1,4}\/default\.jpg/gim,
    getUrl: (match) => `${match[1]}info.json`
  }
]

export function extractIIIFUrlsFromHTML(doc, pageUrl) {
  const discovered = []
  const seen = new Set()
  let truncated = false

  for (const rule of HTML_DISCOVERY_RULES) {
    const matches = uniqueMatches(doc, rule, pageUrl)

    if (matches.length > MAX_URLS_PER_RULE) {
      truncated = true
    }

    for (const url of matches.slice(0, MAX_URLS_PER_RULE)) {
      addUnique(discovered, seen, url)
    }
  }

  return { truncated, urls: discovered }
}

export function normalizeIIIFLinkCandidates(candidates, pageUrl) {
  const urls = []
  const seen = new Set()
  const values = Array.isArray(candidates) ? candidates : []

  for (const candidate of values.slice(0, MAX_URLS_PER_RULE)) {
    addUnique(urls, seen, normalizeCandidateUrl(candidate, pageUrl))
  }

  return {
    truncated: values.length > MAX_URLS_PER_RULE,
    urls
  }
}

export function extractIIIFUrlsFromPageUrl(pageUrl) {
  const discovered = []
  const seen = new Set()

  for (const url of extractImageInfoUrls(pageUrl)) {
    addUnique(discovered, seen, url)
  }

  for (const url of getInstitutionUrlsFromPageUrl(pageUrl)) {
    addUnique(discovered, seen, normalizeCandidateUrl(url))
  }

  return discovered
}

export function extractIIIFUrlsFromJSON(body, sourceUrl) {
  return getInstitutionUrlsFromJSON(body, sourceUrl)
    .map((url) => normalizeCandidateUrl(url))
    .filter(Boolean)
}

export function isHttpUrl(url) {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

export function isJsonContentType(contentType) {
  return /^application\/(?:ld\+)?json\b/i.test(contentType || '') ||
    /^application\/[^;]+\+json\b/i.test(contentType || '')
}

export function shouldFetchBodyAfterHead(url, status, contentType) {
  if (shouldInstitutionFetchBodyAfterHead(url, status)) {
    return true
  }

  if (!isExplicitIIIFManifestUrl(url)) {
    return false
  }

  return status >= 400 || !isJsonContentType(contentType)
}

function isExplicitIIIFManifestUrl(url) {
  try {
    const href = new URL(url).href.toLowerCase()
    return href.includes('iiif') && href.includes('manifest')
  } catch {
    return false
  }
}

function uniqueMatches(doc, rule, baseUrl) {
  const urls = []
  const seen = new Set()
  rule.pattern.lastIndex = 0

  for (const match of doc.matchAll(rule.pattern)) {
    const url = normalizeCandidateUrl(rule.getUrl(match), baseUrl)

    if (!url || rule.reject?.(url)) {
      continue
    }

    addUnique(urls, seen, url)
  }

  return urls
}

function extractImageInfoUrls(value) {
  const imageRule = HTML_DISCOVERY_RULES.find((rule) => rule.name === 'image-api')
  return uniqueMatches(value, imageRule)
}

function addUnique(urls, seen, url) {
  if (url && !seen.has(url)) {
    urls.push(url)
    seen.add(url)
  }
}

function normalizeCandidateUrl(url, baseUrl) {
  if (!url) {
    return null
  }

  const normalized = url
    .replace(/&amp;/g, '&')
    .replace(/[.;)]+$/g, '')

  if (!baseUrl) {
    return normalized
  }

  try {
    const resolved = new URL(normalized, baseUrl)
    return isHttpUrl(resolved.href) ? resolved.href : null
  } catch {
    return null
  }
}
