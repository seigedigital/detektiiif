import Defaults from '../../themes/active/Defaults.js'
import {
  analyzeIIIFResource,
  buildIIIFItem,
  getIIIFStorageKey
} from './tools/iiif'
import {
  extractIIIFUrlsFromHTML,
  extractIIIFUrlsFromJSON,
  extractIIIFUrlsFromPageUrl,
  isHttpUrl,
  isJsonContentType,
  normalizeIIIFLinkCandidates,
  shouldFetchBodyAfterHead
} from './tools/discovery'
import {
  isUrlIgnoredByDomainList,
  normalizeIgnoreDomains
} from '../../shared/ignoredDomains'
import { v4 } from 'uuid'

(function () {

  const globalDefaults = new Defaults()

  let tabStorage = {}
  let tabGeneration = 0
  const cache = {}
  const cache_cors = {}
  const cacheOrder = []
  const fetchSubscribers = {}
  const MAX_CACHE_ENTRIES = 500
  let ignoreDomains = []
  const animSequence = ['◐', '◓', '◑', '◒']

  const networkFilters = {
    urls: [
      "<all_urls>"
    ]
  }

  //
  // FUNCTIONS
  //

  function saveLocalTabStorage() {
    // console.log({saving:tabStorage})
    chrome.storage.local.set({ tabStorage: JSON.stringify(tabStorage) })
  }

  function loadLocalTabStorage() {
    chrome.storage.local.get(['tabStorage'], (result) => {
      if ('tabStorage' in result) {
        try {
          const storedTabStorage = JSON.parse(result.tabStorage)
          const loadedTabStorage = {}

          for (let tabId in storedTabStorage) {
            loadedTabStorage[tabId] = normalizeTabStorageEntry(tabId, storedTabStorage[tabId])
            loadedTabStorage[tabId].badgeDisplay = ''
          }
          tabStorage = Object.assign(loadedTabStorage, tabStorage)
        } catch (error) {
          console.warn('Could not parse stored tabStorage.', error)
        }
      }
    })
  }

  function getNewTabTemplate(tabId) {
    return ({
      id: tabId,
      requests: {},
      fetch: [],
      truncated: false,
      badgeText: '',
      badgeDisplay: '',
      url: '',
      iiif: {
        manifests: {},
        images: {},
        collections: {}
      },
      registerTime: ++tabGeneration
    })
  }

  function normalizeTabStorageEntry(tabId, entry = {}) {
    const template = getNewTabTemplate(tabId)
    const iiif = entry.iiif || {}

    return Object.assign({}, template, entry, {
      fetch: Array.isArray(entry.fetch) ? entry.fetch : [],
      iiif: {
        manifests: iiif.manifests || {},
        images: iiif.images || {},
        collections: iiif.collections || {}
      },
      requests: entry.requests || {}
    })
  }

  function ensureTabStorage(tabId) {
    if (!(tabId in tabStorage)) {
      tabStorage[tabId] = getNewTabTemplate(tabId)
    }

    return tabStorage[tabId]
  }

  function initTabStorage(tabId, url = '') {
    tabStorage[tabId] = getNewTabTemplate(tabId)
    tabStorage[tabId].url = url
    saveLocalTabStorage()
    updateIcon(tabId)
  }

  function hasTabDetectionState(tabData) {
    if (!tabData) {
      return false
    }

    return (
      Object.values(tabData.iiif || {}).some((entries) => Object.keys(entries || {}).length > 0) ||
      Object.keys(tabData.requests || {}).length > 0 ||
      (tabData.fetch || []).length > 0 ||
      Boolean(tabData.truncated)
    )
  }

  function clearTabStorageForUrl(tabId, url = '') {
    const tabData = tabStorage[tabId]

    if (!tabData || tabData.url !== url || hasTabDetectionState(tabData)) {
      initTabStorage(tabId, url)
      return
    }

    updateIcon(tabId)
  }

  function addToTabStorage(tabId, iiifkey, key, value) {
    // console.log({ ADDING: { iiifkey: iiifkey, key: key, value: value } })
    const tabData = ensureTabStorage(tabId)

    if (!(iiifkey in tabData.iiif)) {
      console.warn('Unknown IIIF storage key: ' + iiifkey)
      return
    }

    tabData.iiif[iiifkey][key] = value
    saveLocalTabStorage()
    updateIcon(tabId)
  }

  function updateInTabStorage(tabId, key, value) {
    const tabData = ensureTabStorage(tabId)

    switch (key) {
      case 'updaterequest':
        for (let tid in tabStorage) {
          if (value.requestId in tabStorage[tid]['requests']) {
            tabStorage[tid]['requests'][value.requestId] = Object.assign({}, tabStorage[tid]['requests'][value.requestId], value)
          }
        }
        break
      case 'addfetch':
        tabData.fetch.push(value)
        break
      case 'remfetch':
        tabData.fetch = tabData.fetch.filter(function (item) {
          return item !== value
        })
        break
      case 'addrequest':
        tabData.requests[value.requestId] = Object.assign({}, value)
        break
      default:
        break
    }
    saveLocalTabStorage()
    updateIcon(tabId)
  }

  function queueFetch(url, tabId) {
    if (filterURLs(url)) {
      return
    }

    registerFetchSubscriber(url, tabId)
    if (cache[url] === 'INPROGRESS') {
      return
    }

    fetchHttp(url, tabId, true)
  }

  function registerFetchSubscriber(url, tabId) {
    const tabData = ensureTabStorage(tabId)
    if (!fetchSubscribers[url]) {
      fetchSubscribers[url] = new Map()
    }
    fetchSubscribers[url].set(String(tabId), tabData.registerTime)
  }

  function compileFetchSubscribers(url) {
    const subscribers = fetchSubscribers[url] || new Map()
    subscribers.forEach((generation, tabId) => {
      compileData(url, parseInt(tabId), generation)
    })
    delete fetchSubscribers[url]
  }

  function clearFetchSubscribers(url) {
    delete fetchSubscribers[url]
  }

  function setCacheValue(url, value) {
    cache[url] = value

    if (value === 'INPROGRESS') {
      return
    }

    const previousIndex = cacheOrder.indexOf(url)
    if (previousIndex >= 0) {
      cacheOrder.splice(previousIndex, 1)
    }
    cacheOrder.push(url)

    while (cacheOrder.length > MAX_CACHE_ENTRIES) {
      const obsoleteUrl = cacheOrder.shift()
      delete cache[obsoleteUrl]
      delete cache_cors[obsoleteUrl]
      delete fetchSubscribers[obsoleteUrl]
    }
  }

  function markTabTruncated(tabId) {
    ensureTabStorage(tabId).truncated = true
    saveLocalTabStorage()
  }

  //
  // ENTRY POINT into fetching cascade
  //
  function fetchHttp(url, tabId, subscriberRegistered = false) {
    if (!isHttpUrl(url)) {
      // console.log("URL denied, we're http(s) only: " + url)
      return
    }

    if (!subscriberRegistered) {
      registerFetchSubscriber(url, tabId)
    }
    fetchWorkStart(url, tabId)    // let's go
    // we always try https too
    if (url.startsWith("http:")) {
      const httpsUrl = url.replace(/^http\:/i, "https:")
      registerFetchSubscriber(httpsUrl, tabId)
      fetchWorkStart(httpsUrl, tabId)
    }
  }

  function fetchWorkStart(url, tabId) {
    // check Cache
    if (cache[url] !== undefined && cache[url] !== "INPROGRESS") {
      // known already? jusr recompile data
      compileFetchSubscribers(url)
      return
    }
    // unknown: let's check it out
    setCacheValue(url, "INPROGRESS")
    fetchWorkHeader(url, tabId)
  }

  function fetchWorkHeader(url, tabId) {
    if (!isHttpUrl(url)) {
      // console.log("URL denied (HEAD), we're http(s) only.")
      return
    }
    // console.log("HEAD " + url)
    // FIXME workaround to avoid problems chrome's cache vs dynamic cors headers, example: https://edl.beniculturali.it/beu/850013655
    // Upd: ran into troubles, switch back to force-cache, ignoring dynamic cors cases
    let fkey = v4()
    updateInTabStorage(tabId, 'addfetch', fkey)
    fetch(url, { method: 'HEAD', cache: 'force-cache', follow: 'follow', referrerPolicy: 'no-referrer' })
      .then((response) => {
        let c = response.headers.get("access-control-allow-origin")
        cache_cors[url] = c === "*"
        let t = response.headers.get("content-type")
        let s = response.headers.get("content-length")

        if (shouldFetchBodyAfterHead(url, response.status, t)) {
          // console.log(response)
          // console.log("HEAD not usable. GETting...")
          fetchWorkBody(url, tabId)
          updateInTabStorage(tabId, 'remfetch', fkey)
          return
        }

        // console.log(t + " " + s + " " + url)
        // console.log(response.status)
        if (isJsonContentType(t)) {
          // console.log("Accepted for GET Req: " + url)
          fetchWorkBody(url, tabId)
        } else {
          setCacheValue(url, false)
          clearFetchSubscribers(url)
          // console.log("Rejected: " + url)
        }
        updateInTabStorage(tabId, 'remfetch', fkey)
      })
      .catch((error) => {
        updateInTabStorage(tabId, 'remfetch', fkey)
        setCacheValue(url, false)
        clearFetchSubscribers(url)
        // console.debug('Error HEAD Req:', error)
        // if(url.startsWith('http') && !url.includes('?')) {
        //   console.log("Let's try GET... "+" // "+url)
        //   fetchWorkBody(url,tabId)
        // }
      })
  }

  function fetchWorkBody(url, tabId) {
    if (!isHttpUrl(url)) {
      // console.log("URL denied (BODY), we're http(s) only.")
      return
    }

    const cacheMode = cache_cors[url] === true ? 'force-cache' : 'no-store'

    let fkey = v4()
    updateInTabStorage(tabId, 'addfetch', fkey)
    // FIXME workaround to avoid problems chrome's cache vs dynamic cors headers, example: https://edl.beniculturali.it/beu/850013655
    fetch(url, { method: 'GET', cache: cacheMode, referrerPolicy: 'no-referrer' })
      .then(res => res.json())
      .then((data) => {
        // console.log({ got: data })
        setCacheValue(url, data)
        compileFetchSubscribers(url)
        // console.log("ADDing " + url + "to " + tabId)
        updateInTabStorage(tabId, 'remfetch', fkey)
      })
      .catch((error) => {
        // console.debug('Error GET Req:', error)
        setCacheValue(url, false)
        clearFetchSubscribers(url)
        updateInTabStorage(tabId, 'remfetch', fkey)
      })
  }

  function compileData(url, tabId, generation = ensureTabStorage(tabId).registerTime) {
    // console.log("compileData " + url)
    let data = cache[url]

    if (tabStorage[tabId]?.registerTime !== generation) {
      return
    }

    if (cache[url] === false) {
      // console.log("cache denial for " + url)
      return
    }

    if (cache[url] === "INPROGRESS") {
      // console.log("skipping INPROGRESS " + url)
      return
    }

    let iiif = analyzeIIIFResource(data)
    if (!iiif) {
      const institutionUrls = extractIIIFUrlsFromJSON(data, url)

      if (institutionUrls.length > 0) {
        // console.log("Institution rules found IIIF candidates for " + url)
        setCacheValue(url, false)
        for (const institutionUrl of institutionUrls) {
          queueFetch(institutionUrl, tabId)
        }
        return
      }

      setCacheValue(url, false)
      // console.log("NO for " + url)
      return
    }
    // we have proven IIIF data here
    
    // console.log("OK for " + url)

    const item = buildIIIFItem(data, url, iiif, cache_cors[url])
    const storageKey = getIIIFStorageKey(iiif)

    addToTabStorage(tabId, storageKey, item.id, item)
    // console.log("compileData-END")
    updateIcon(tabId)
  }

  function analyzeHTMLBody(doc, tabId, pageUrl, linkCandidates = []) {
    const htmlResult = extractIIIFUrlsFromHTML(doc, pageUrl)
    const linkResult = normalizeIIIFLinkCandidates(linkCandidates, pageUrl)
    const urls = Array.from(new Set([...htmlResult.urls, ...linkResult.urls]))

    if (htmlResult.truncated || linkResult.truncated) {
      // console.log("detektIIIF: limiting huge number of matches")
      markTabTruncated(tabId)
    }

    for (const url of urls) {
      // console.log("check guessed URL: " + url)
      queueFetch(url, tabId)
    }
  }

  function updateAllIcons() {
    for (let tabId in tabStorage) {
      chrome.tabs.get(parseInt(tabId), (tab) => {
        if (tab && tab.id !== chrome.tabs.TAB_ID_NONE) {
          updateIcon(parseInt(tabId))
        } else {
          // console.log("Tab " + tabId + " not available. Deleting storage.")
          delete tabStorage[tabId]
          saveLocalTabStorage()
        }
      })
    }
  }

  function updateIcon(tabId) {
    try {
      // console.log("updateIcon "+tabId)

      if (!(tabId in tabStorage)) {
        // console.log("NO tabId in result (updateIcon)")
        return
      }

      let pending = tabStorage[tabId].fetch.length > 0
      if (!pending) {
        for (const [key, request] of Object.entries(tabStorage[tabId].requests)) {
          // console.log({req:request})
          if (request.status === 'pending') {
            pending = true
            break
          }
        }
      }

      // console.log("PENDING "+pending)

      let num = 0

      if (globalDefaults.tabs === true) {
        num = Object.keys(tabStorage[tabId].iiif.manifests).length +
          Object.keys(tabStorage[tabId].iiif.collections).length +
          Object.keys(tabStorage[tabId].iiif.images).length
      } else {
        switch (globalDefaults.singleView) {
          case 'MANIFESTS':
            num = Object.keys(tabStorage[tabId].iiif.manifests).length
            break
          case 'COLLECTIONS':
            num = Object.keys(tabStorage[tabId].iiif.collections).length
            break
          case 'IMAGES':
            num = Object.keys(tabStorage[tabId].iiif.images).length
            break
          default:
            break
        }
      }

      // console.log("ICON NUM ("+tabId+")"+num)

      // hourglass unicode: '\u231b' (ugly)

      // console.log({TSBADGE:tabStorage[tabId]})
      // console.log("tabId: "+tabId)
      // console.log("NM: "+Object.keys(tabStorage[tabId].iiif.manifests).length)
      // console.log("NC: "+Object.keys(tabStorage[tabId].iiif.collections).length)
      // console.log("NI: "+Object.keys(tabStorage[tabId].iiif.images).length)
      // console.log("NUM: "+num)

      if (pending) {
        // chrome.action.setBadgeText({text:'P',tabId:tabId})
        tabStorage[parseInt(tabId)].badgeText = 'P'
      } else {
        // chrome.action.setBadgeText({text:num.toString(),tabId:tabId})
        tabStorage[parseInt(tabId)].badgeText = num > 0 ? num.toString() : ''
      }

      // setIcon(tabStorage[parseInt(tabId)].badgeText,tabId)

    } catch {
      // console.log("unknown error during updateIcon()")
    }
  }

  function eternalIconUpdateLoop() {
    for (let tabId in tabStorage) {
      let value = false
      let ptr = Math.floor((Date.now() / 250) % animSequence.length)
      let save = false
      if (tabStorage[tabId].badgeText === 'P') {
        value = animSequence[ptr]
      } else {
        value = tabStorage[tabId].badgeText
        if (tabStorage[tabId].truncated === true) {
          value = value + "+"
        }
        save = true
      }
      if (value !== undefined) {
        if (tabStorage[tabId].badgeDisplay !== value) {
          chrome.tabs.get(
            parseInt(tabId),
            () => {
              if (chrome.runtime.lastError) {
                // console.log(chrome.runtime.lastError.message)
              } else {
                setIcon(value, parseInt(tabId))
                tabStorage[tabId].badgeDisplay = value
                if (save) {
                  saveLocalTabStorage()
                }
              }
            }
          )
        }
      }
    }
    setTimeout(eternalIconUpdateLoop, 250)
  }

  function setIcon(value, tabId) {
    chrome.action.setBadgeBackgroundColor({ color: [255, 0, 0, 255], tabId: tabId })
    if (typeof chrome.action.setBadgeTextColor === 'function') {
      chrome.action.setBadgeTextColor({ color: [255, 255, 255, 255], tabId: tabId })
    }
    chrome.action.setBadgeText({ text: value, tabId: tabId })
  }

  function filterURLs(url) { // returns true=block, false=accept
    // console.log("url: " + url)
    // console.log({ cacheFromUrl: cache[url] })

    if (isUrlIgnoredByDomainList(url, ignoreDomains)) {
      // console.log("IGNORED BY DOMAIN RULE: " + url)
      return true
    }

    if (cache[url] === false) {
      // console.log("IGNORED BY CACHE RULE: " + url)
      return true
    } else if (cache.hasOwnProperty(url)) {
      // console.log("ALLOWING URL BY CACHE: " + url)
      return false
    }

    try {
      new URL(url)
    } catch {
      // console.log("NO REGEX MATCH: " + url)
      return true
    }
    // console.log("GOOD: "+url)
    return false
  }

  //
  //  PROGRAM STARTS HERE
  //

  chrome.runtime.onMessage.addListener((msg, sender, response) => {

    // console.log("onMessage")

    switch (msg.type) {
      case 'popupInit':
        // console.log("POPUP INIT")
        // console.log(tabStorage)
        //  send Info on current Tab
        response(Object.assign({}, tabStorage[msg.tabId]))
        break
      default:
        response('unknown request')
        break
    }
  })


  chrome.webRequest.onHeadersReceived.addListener((details) => {
    // console.log("HEADERS RECVD")
    // console.log(details)

    var { tabId, requestId, url, method } = details

    if (tabId === chrome.tabs.TAB_ID_NONE) {
      return
    }

    // console.log("URL: "+url)

    // tabId = fixTabId(tabId)

    if (filterURLs(url)) {
      return
    }

    if (method !== "GET") {
      setCacheValue(url, false)
      return
    }

    let accepted = false
    let cors = false

    for (const item of details.responseHeaders || []) {
      const name = item.name.toLowerCase()
      const value = item.value || ''

      if (name === "content-type" && isJsonContentType(value)) {
        accepted = true
      }

      if (name === "access-control-allow-origin" && value.includes("*")) {
        cache_cors[url] = cors = true
      }

      if (name === "content-length" && Number(value) > 1000000) {
        // console.log("discard(2) "+details.url)
        accepted = false
        setCacheValue(url, false)
        return
      }
    }

    if (accepted === false) {
      setCacheValue(url, false)
      return
    }

    // tabStorage[tabId].requests[requestId] = {
    //     requestId: requestId,
    //     url: details.url,
    //     startTime: details.timeStamp,
    //     cors: cors,
    //     status: 'pending'
    // }
    updateInTabStorage(tabId, 'addrequest', {
      requestId: requestId,
      url: details.url,
      startTime: details.timeStamp,
      cors: cors,
      status: 'pending'
    })

    // console.log(tabStorage[tabId].requests[requestId])
  }, networkFilters, ["responseHeaders"])


  chrome.webRequest.onCompleted.addListener((details) => {

    // console.log("onCompleted")

    let { tabId, requestId, url } = details

    if (tabId === chrome.tabs.TAB_ID_NONE) {
      // console.log("TAB_ID_NONE")
      return
    }

    if (filterURLs(url)) {
      // console.log("filtered URL")
      return
    }

    updateInTabStorage(tabId, 'updaterequest', {
      requestId: requestId,
      endTime: details.timeStamp,
      responseHeaders: JSON.stringify(details.responseHeaders),
      status: 'complete'
    })

    if (!tabStorage.hasOwnProperty(tabId) || !tabStorage[tabId].requests.hasOwnProperty(requestId)) {
      // console.log("Exit no ID")
      return
    }

    // console.debug("DETEKTIIIF CHECKING "+url)

    if (cache.hasOwnProperty(url)) {
      // console.debug("DETEKTIIIF CACHE HIT: " + url)
      if (cache[url]) {
        compileData(url, tabId)
        return
      }
    } else {
      // console.debug("DETEKTIIIF CACHE MISS: " + url)
      fetchHttp(url, tabId)
    }

  }, networkFilters, ["responseHeaders"])

  function collectPageCandidates() {
    if (typeof document === 'undefined') {
      return
    }

    const keywordPattern = /\b(?:iiif|i3f|manifest)\b/i
    const candidates = new Set()
    const addCandidate = (value) => {
      if (candidates.size >= 100 || !value) {
        return
      }

      try {
        const url = new URL(value, window.location.href)
        if (url.protocol === 'http:' || url.protocol === 'https:') {
          candidates.add(url.href)

          const imageMatch = url.href.match(
            /^(https?:\/\/[^"<>]+\/)[maxful0-9,!]+\/[maxful0-9,!]+\/[0-9!]{1,4}\/default\.jpg(?:[?#].*)?$/i
          )
          if (imageMatch) {
            candidates.add(`${imageMatch[1]}info.json`)
          }
        }
      } catch {
        // Ignore malformed attributes and script fragments.
      }
    }

    Array.from(document.querySelectorAll('a[href], link[href]'))
      .forEach((element) => {
        const clues = [
          element.getAttribute('href'),
          element.textContent,
          element.getAttribute('title'),
          element.getAttribute('aria-label'),
          element.getAttribute('rel'),
          element.getAttribute('type'),
          element.querySelector('img[alt]')?.getAttribute('alt')
        ]

        if (clues.some((value) => keywordPattern.test(value || ''))) {
          addCandidate(element.getAttribute('href'))
        }
      })

    Array.from(document.querySelectorAll('[href], [src]')).forEach((element) => {
      for (const attribute of ['href', 'src']) {
        const value = element.getAttribute(attribute)
        if (keywordPattern.test(value || '')) {
          addCandidate(value)
        }
      }
    })

    Array.from(document.querySelectorAll('*')).some((element) => {
      for (const attribute of Array.from(element.attributes || [])) {
        if (attribute.name.startsWith('data-') && keywordPattern.test(attribute.value || '')) {
          addCandidate(attribute.value)
        }
      }

      return candidates.size >= 100
    })

    const inlineUrlPattern = /https?:\/\/[^"'<>\s]*(?:iiif|i3f|manifest)[^"'<>\s]*/gi
    Array.from(document.scripts).some((script) => {
      for (const match of (script.textContent || '').matchAll(inlineUrlPattern)) {
        addCandidate(match[0])
        if (candidates.size >= 100) {
          break
        }
      }

      return candidates.size >= 100
    })

    return {
      linkCandidates: Array.from(candidates),
      pageUrl: window.location.href,
    }
  }

  function getAndObserve(tabId) {
    const tabData = ensureTabStorage(tabId)

    chrome.scripting.executeScript({
      target: { tabId: parseInt(tabId) },
      func: collectPageCandidates,
    }, (results) => {
      if (chrome.runtime.lastError) {
        console.warn('Could not inspect tab DOM.', chrome.runtime.lastError.message)
        return
      }

      if (tabStorage[tabId]?.registerTime !== tabData.registerTime) {
        return
      }

      const pageData = results?.find((result) => result.frameId === 0)?.result
      if (pageData?.pageUrl) {
        analyzeHTMLBody('', tabId, pageData.pageUrl, pageData.linkCandidates)
      }
    }
    )

  }

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // console.log("UPDATE TAB " + tabId)
    // console.log(changeInfo)

    if (tabId === chrome.tabs.TAB_ID_NONE) {
      // console.log("chrome.tabs.onUpdated: called on none-tab")
      return
    }

    const nextUrl = typeof tab.url === 'string' ? tab.url : changeInfo.url

    if (nextUrl && !isHttpUrl(nextUrl)) {
      clearTabStorageForUrl(tabId, nextUrl)
      return
    }

    if (nextUrl && isUrlIgnoredByDomainList(nextUrl, ignoreDomains)) {
      // console.log("chrome.tabs.onUpdated: ignored domain " + tab.url)
      clearTabStorageForUrl(tabId, nextUrl)
      return
    }

    if (nextUrl && tabStorage[tabId]?.url && tabStorage[tabId].url !== nextUrl) {
      initTabStorage(tabId, nextUrl)
    } else if (nextUrl) {
      ensureTabStorage(tabId).url = nextUrl
    }

    if (tabStorage[tabId] !== undefined) {
      tabStorage[tabId].badgeDisplay = ''
    }

    if (typeof tab.url === 'string') {
      for (const url of extractIIIFUrlsFromPageUrl(tab.url)) {
        // console.log("check page URL rule: " + url)
        queueFetch(url, tabId)
      }
    }

    // if(filterURLs(tab.url)) {
    //   console.log("chrome.tabs.onUpdated: filtered URL "+tab.url)
    //   return
    // }

    if (changeInfo.status === 'complete') {
      getAndObserve(tabId)
      updateIcon(tabId)
    }
  })

  //

  chrome.tabs.onActivated.addListener((tabInfo) => {
    // console.log({ activatedTab: tabInfo })

    if (!tabInfo) {
      // console.log("No tab, returning.")
      return
    }

    const tabId = tabInfo.tabId
    if (tabId === chrome.tabs.TAB_ID_NONE) {
      // console.log("TAB_ID_NONE, returning.")
      return
    }

    // console.log("ACTIVE TAB is " + tabId)
    // console.log({ tabStoragebytabid: tabStorage[tabId] })

    if (tabStorage[tabId] === undefined) {
      // console.log("NO INFO about " + tabId + " resetting tabStorage")
      initTabStorage(tabId)
    }
    // console.log("onActivated")
    updateIcon(tabId)

    // console.log("GETTING TAB " + tabId)
    // chrome.tabs.get(tabId).then((tab) => {
    try {
      // console.log("chrome.tabs.get")
      chrome.tabs.get(parseInt(tabId), (tab) => {
        if (chrome.runtime.lastError || !tab || !isHttpUrl(tab.url)) {
          // console.log("Couldn't use Tab " + tabId)
          return
        }

        if (isUrlIgnoredByDomainList(tab.url, ignoreDomains)) {
          // console.log("chrome.tabs.onActivated: ignored domain " + tab.url)
          return
        }

        // console.log({ tab: tab })
        // just give it a try
        queueFetch(tab.url, tab.id)

        for (const url of extractIIIFUrlsFromPageUrl(tab.url)) {
          // console.log("check page URL rule: " + url)
          queueFetch(url, tab.id)
        }
      })
    } catch {
      // console.log("Couldn't get Tab " + tabId)
    }
  })

  chrome.tabs.onReplaced.addListener((newTabId, oldTabId) => {
    // console.log("onReplaced from:" + oldTabId + " to:" + newTabId)
    tabStorage[newTabId] = normalizeTabStorageEntry(
      newTabId,
      tabStorage[oldTabId] || {}
    )
    delete tabStorage[oldTabId]
    saveLocalTabStorage()
  })

  chrome.tabs.onRemoved.addListener((tabId) => {
    // console.log("REM " + tabId)
    if (tabId === chrome.tabs.TAB_ID_NONE) {
      // console.log("NO REM 1 " + tabId)
      return
    }

    if (!tabStorage.hasOwnProperty(tabId)) {
      // console.log("NO REM 2 " + tabId)
      return
    }
    // console.log("REMOVING " + tabId)
    delete tabStorage[tabId]
    saveLocalTabStorage()
  })

  chrome.storage.onChanged.addListener((changes, namespace) => {
    for (let [key, { oldValue, newValue }] of Object.entries(changes)) {

      if (namespace === "local" && key === "ignoreDomains") {
        ignoreDomains = normalizeIgnoreDomains(
          Array.isArray(newValue) ? newValue : globalDefaults.ignoreDomains
        )

        Object.entries(tabStorage).forEach(([tabId, tabData]) => {
          if (isUrlIgnoredByDomainList(tabData.url, ignoreDomains)) {
            clearTabStorageForUrl(parseInt(tabId), tabData.url)
          }
        })
      }

      if (namespace === 'local') {
        updateAllIcons()
      }

      // console.log(
      //   `Storage key "${key}" in namespace "${namespace}" changed.`,
      //   `Old value was "${oldValue}", new value is "${newValue}".`
      // )
    }
  })

  ignoreDomains = normalizeIgnoreDomains(globalDefaults.ignoreDomains)
  chrome.storage.local.get('ignoreDomains', function (data) {
    // console.log({ GOT: data })
    if (Array.isArray(data.ignoreDomains)) {
      ignoreDomains = normalizeIgnoreDomains(data.ignoreDomains)
    }
  })

  loadLocalTabStorage()

  eternalIconUpdateLoop()

  // console.log("detektIIIF (re)started")

}())
