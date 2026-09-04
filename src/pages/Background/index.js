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
  shouldFetchBodyAfterHead
} from './tools/discovery'
import { v4 } from 'uuid'

(function () {

  const globalDefaults = new Defaults()

  let tabStorage = {}
  const cache = {}
  const cache_cors = {}
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
          tabStorage = {}

          for (let tabId in storedTabStorage) {
            tabStorage[tabId] = normalizeTabStorageEntry(tabId, storedTabStorage[tabId])
            tabStorage[tabId].badgeDisplay = ''
          }
        } catch (error) {
          console.warn('Could not parse stored tabStorage.', error)
          tabStorage = {}
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
      registerTime: new Date().getTime()
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

  function initTabStorage(tabId) {
    tabStorage[tabId] = getNewTabTemplate(tabId)
    saveLocalTabStorage()
    updateIcon(tabId)
  }

  function addToTabStorage(tabId, iiifkey, key, value) {
    console.log({ ADDING: { iiifkey: iiifkey, key: key, value: value } })
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
    if (filterURLs(url) || cache[url] === 'INPROGRESS') {
      return
    }

    fetchHttp(url, tabId)
  }

  function markTabTruncated(tabId) {
    ensureTabStorage(tabId).truncated = true
    saveLocalTabStorage()
  }

  //
  // ENTRY POINT into fetching cascade
  //
  function fetchHttp(url, tabId) {
    if (!isHttpUrl(url)) {
      console.log("URL denied, we're http(s) only: " + url)
      return
    }

    fetchWorkStart(url, tabId)    // let's go
    // we always try https too
    if (url.startsWith("http:")) {
      fetchWorkStart(url.replace(/^http\:/i, "https:"), tabId)
    }
  }

  function fetchWorkStart(url, tabId) {
    // check Cache
    if (cache[url] !== undefined && cache[url] !== "INPROGRESS") {
      // known already? jusr recompile data
      compileData(url, tabId)
      return
    }
    // unknown: let's check it out
    cache[url] = "INPROGRESS"
    fetchWorkHeader(url, tabId)
  }

  function fetchWorkHeader(url, tabId) {
    if (!isHttpUrl(url)) {
      console.log("URL denied (HEAD), we're http(s) only.")
      return
    }
    console.log("HEAD " + url)
    // FIXME workaround to avoid problems chrome's cache vs dynamic cors headers, example: https://edl.beniculturali.it/beu/850013655
    // Upd: ran into troubles, switch back to force-cache, ignoring dynamic cors cases
    let fkey = v4()
    updateInTabStorage(tabId, 'addfetch', fkey)
    fetch(url, { method: 'HEAD', cache: 'force-cache', follow: 'follow', referrerPolicy: 'no-referrer' })
      .then((response) => {
        let c = response.headers.get("access-control-allow-origin")
        cache_cors[url] = c === "*"

        if (shouldFetchBodyAfterHead(url, response.status)) {
          console.log(response)
          console.log("HEAD not usable. GETting...")
          fetchWorkBody(url, tabId)
          updateInTabStorage(tabId, 'remfetch', fkey)
          return
        }

        let t = response.headers.get("content-type")
        let s = response.headers.get("content-length")
        console.log(t + " " + s + " " + url)
        console.log(response.status)
        if (isJsonContentType(t)) {
          console.log("Accepted for GET Req: " + url)
          fetchWorkBody(url, tabId)
        } else {
          cache[url] = false
          console.log("Rejected: " + url)
        }
        updateInTabStorage(tabId, 'remfetch', fkey)
      })
      .catch((error) => {
        updateInTabStorage(tabId, 'remfetch', fkey)
        cache[url] = false
        console.debug('Error HEAD Req:', error)
        // if(url.startsWith('http') && !url.includes('?')) {
        //   console.log("Let's try GET... "+" // "+url)
        //   fetchWorkBody(url,tabId)
        // }
      })
  }

  function fetchWorkBody(url, tabId) {
    if (!isHttpUrl(url)) {
      console.log("URL denied (BODY), we're http(s) only.")
      return
    }

    const cacheMode = cache_cors[url] === true ? 'force-cache' : 'no-store'

    let fkey = v4()
    updateInTabStorage(tabId, 'addfetch', fkey)
    // FIXME workaround to avoid problems chrome's cache vs dynamic cors headers, example: https://edl.beniculturali.it/beu/850013655
    fetch(url, { method: 'GET', cache: cacheMode, referrerPolicy: 'no-referrer' })
      .then(res => res.json())
      .then((data) => {
        console.log({ got: data })
        cache[url] = data
        compileData(url, tabId)
        console.log("ADDing " + url + "to " + tabId)
        updateInTabStorage(tabId, 'remfetch', fkey)
      })
      .catch((error) => {
        console.debug('Error GET Req:', error)
        cache[url] = false
        updateInTabStorage(tabId, 'remfetch', fkey)
      })
  }

  function fetchHTML(url, tabId) {
    if (!isHttpUrl(url)) {
      console.log("URL denied (fetchHTML), we're http(s) only.")
      return
    }
    fetch(url, { method: 'GET', cache: 'no-store', referrerPolicy: 'no-referrer' })
      .then(function (response) {
        return response.text()
      }).then(function (html) {
        // console.log(html)
        analyzeHTMLBody(html, tabId)
      }).catch(function (err) {
        // There was an error
        console.warn('Something went wrong.', err)
      })

  }

  function compileData(url, tabId) {
    console.log("compileData " + url)
    let data = cache[url]

    if (cache[url] === false) {
      console.log("cache denial for " + url)
      return
    }

    if (cache[url] === "INPROGRESS") {
      console.log("skipping INPROGRESS " + url)
      return
    }

    let iiif = analyzeIIIFResource(data)
    if (!iiif) {
      const institutionUrls = extractIIIFUrlsFromJSON(data, url)

      if (institutionUrls.length > 0) {
        console.log("Institution rules found IIIF candidates for " + url)
        cache[url] = false
        for (const institutionUrl of institutionUrls) {
          queueFetch(institutionUrl, tabId)
        }
        return
      }

      cache[url] = false
      console.log("NO for " + url)
      return
    }
    // we have proven IIIF data here
    
    console.log("OK for " + url)

    const item = buildIIIFItem(data, url, iiif, cache_cors[url])
    const storageKey = getIIIFStorageKey(iiif)

    addToTabStorage(tabId, storageKey, item.id, item)
    console.log("compileData-END")
    updateIcon(tabId)
  }

  function analyzeHTMLBody(doc, tabId) {
    const { truncated, urls } = extractIIIFUrlsFromHTML(doc)

    if (truncated) {
      console.log("detektIIIF: limiting huge number of matches")
      markTabTruncated(tabId)
    }

    for (const url of urls) {
      console.log("check guessed URL: " + url)
      queueFetch(url, tabId)
    }
  }

  function updateAllIcons() {
    for (let tabId in tabStorage) {
      chrome.tabs.get(parseInt(tabId), (tab) => {
        if (tab && tab.id !== chrome.tabs.TAB_ID_NONE) {
          updateIcon(parseInt(tabId))
        } else {
          console.log("Tab " + tabId + " not available. Deleting storage.")
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
        console.log("NO tabId in result (updateIcon)")
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
      console.log("unknown error during updateIcon()")
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
                console.log(chrome.runtime.lastError.message)
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
    console.log("url: " + url)
    console.log({ cacheFromUrl: cache[url] })
    if (cache[url] === false) {
      console.log("IGNORED BY CACHE RULE: " + url)
      return true
    } else if (cache.hasOwnProperty(url)) {
      console.log("ALLOWING URL BY CACHE: " + url)
      return false
    }

    let hostname

    try {
      hostname = new URL(url).hostname
    } catch {
      console.log("NO REGEX MATCH: " + url)
      return true
    }
    // hostname = hostname[hostname.length-2]+"."+hostname[hostname.length-1]
    for (const domain of ignoreDomains) {
      const filterDomain = String(domain || '').trim()

      if (!filterDomain) {
        continue
      }

      if (hostname.endsWith(filterDomain)) {
        console.log("IGNORED BY HOSTNAME (" + hostname + "), SETTING CACHE RULE: " + url)
        cache[url] = false
        return true
      }
    }
    // console.log("GOOD: "+url)
    return false
  }

  //
  //  PROGRAM STARTS HERE
  //

  chrome.runtime.onMessage.addListener((msg, sender, response) => {

    console.log("onMessage")

    switch (msg.type) {
      case 'popupInit':
        console.log("POPUP INIT")
        console.log(tabStorage)
        //  send Info on current Tab
        response(Object.assign({}, tabStorage[msg.tabId]))
        break
      case 'docLoad':
        console.log("DOC RECIEVED")
        // console.log(msg.doc)
        if (typeof msg.doc === 'string') {
          // console.log(msg.doc.indexOf('manifest'))
          analyzeHTMLBody(msg.doc, msg.tabId)
        }
        break
      case 'fetchHTML':
        console.log("Getting iframe " + msg.url)
        fetchHTML(msg.url, msg.tabId)
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
      cache[url] = false
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
        cache[url] = false
        return
      }
    }

    if (accepted === false) {
      cache[url] = false
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

    console.log("onCompleted")

    let { tabId, requestId, url } = details

    if (tabId === chrome.tabs.TAB_ID_NONE) {
      console.log("TAB_ID_NONE")
      return
    }

    if (filterURLs(url)) {
      console.log("filtered URL")
      return
    }

    updateInTabStorage(tabId, 'updaterequest', {
      requestId: requestId,
      endTime: details.timeStamp,
      responseHeaders: JSON.stringify(details.responseHeaders),
      status: 'complete'
    })

    if (!tabStorage.hasOwnProperty(tabId) || !tabStorage[tabId].requests.hasOwnProperty(requestId)) {
      console.log("Exit no ID")
      return
    }

    // console.debug("DETEKTIIIF CHECKING "+url)

    if (cache.hasOwnProperty(url)) {
      console.debug("DETEKTIIIF CACHE HIT: " + url)
      if (cache[url]) {
        compileData(url, tabId)
        return
      }
    } else {
      console.debug("DETEKTIIIF CACHE MISS: " + url)
      fetchHttp(url, tabId)
    }

  }, networkFilters, ["responseHeaders"])

  function sendMsg(tabId) {
    console.log("sendMsg")

    if (typeof document === 'undefined') {
      console.log("NO DOCUMENT DEFINED")
      return
    }

    chrome.runtime.sendMessage(
      { type: 'docLoad', doc: document.documentElement.innerHTML, tabId: tabId }
    )
  }

  function getAndObserve(tabId) {

    console.log("OBSERVING: " + tabId)

    console.log("EXEC SCRIPT")
    chrome.scripting.executeScript({
      target: { tabId: parseInt(tabId) },
      func: sendMsg,
      args: [tabId]
    }, () => {
      console.log("What the fish?")
      if (chrome.runtime.lastError) {
        console.log("Whoops.. " + chrome.runtime.lastError.message)
      } else {
      }
    }
    )

  }

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    console.log("UPDATE TAB " + tabId)
    console.log(changeInfo)

    if (tabId === chrome.tabs.TAB_ID_NONE) {
      console.log("chrome.tabs.onUpdated: called on none-tab")
      return
    }

    if ((typeof tab.url === 'string') && (!isHttpUrl(tab.url))) {
      return
    }

    // if(changeInfo.url) {
    //   if(tabStorage[tabId].url!==changeInfo.url) {
    //     tabStorage[tabId].url = changeInfo.url
    //     initTabStorage(tabId)
    //   }
    // }

    if (tabStorage[tabId] !== undefined) {
      tabStorage[tabId].badgeDisplay = ''
    }

    if (typeof tab.url === 'string') {
      for (const url of extractIIIFUrlsFromPageUrl(tab.url)) {
        console.log("check page URL rule: " + url)
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
    console.log({ activatedTab: tabInfo })

    if (!tabInfo) {
      console.log("No tab, returning.")
      return
    }

    const tabId = tabInfo.tabId
    if (tabId === chrome.tabs.TAB_ID_NONE) {
      console.log("TAB_ID_NONE, returning.")
      return
    }

    console.log("ACTIVE TAB is " + tabId)
    console.log({ tabStoragebytabid: tabStorage[tabId] })

    if (tabStorage[tabId] === undefined) {
      console.log("NO INFO about " + tabId + " resetting tabStorage")
      initTabStorage(tabId)
    }
    console.log("onActivated")
    updateIcon(tabId)

    console.log("GETTING TAB " + tabId)
    // chrome.tabs.get(tabId).then((tab) => {
    try {
      console.log("chrome.tabs.get")
      chrome.tabs.get(parseInt(tabId), (tab) => {
        if (chrome.runtime.lastError || !tab || !isHttpUrl(tab.url)) {
          console.log("Couldn't use Tab " + tabId)
          return
        }

        console.log({ tab: tab })
        // just give it a try
        queueFetch(tab.url, tab.id)

        for (const url of extractIIIFUrlsFromPageUrl(tab.url)) {
          console.log("check page URL rule: " + url)
          queueFetch(url, tab.id)
        }
      })
    } catch {
      console.log("Couldn't get Tab " + tabId)
    }
  })

  chrome.tabs.onReplaced.addListener((newTabId, oldTabId) => {
    console.log("onReplaced from:" + oldTabId + " to:" + newTabId)
    tabStorage[newTabId] = normalizeTabStorageEntry(
      newTabId,
      tabStorage[oldTabId] || {}
    )
    delete tabStorage[oldTabId]
    saveLocalTabStorage()
  })

  chrome.tabs.onRemoved.addListener((tabId) => {
    console.log("REM " + tabId)
    if (tabId === chrome.tabs.TAB_ID_NONE) {
      console.log("NO REM 1 " + tabId)
      return
    }

    if (!tabStorage.hasOwnProperty(tabId)) {
      console.log("NO REM 2 " + tabId)
      return
    }
    console.log("REMOVING " + tabId)
    delete tabStorage[tabId]
    saveLocalTabStorage()
  })

  chrome.storage.onChanged.addListener((changes, namespace) => {
    for (let [key, { oldValue, newValue }] of Object.entries(changes)) {

      if (namespace === "local" && key === "ignoreDomains") {
        ignoreDomains = Array.isArray(newValue) ? newValue : globalDefaults.ignoreDomains
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

  ignoreDomains = globalDefaults.ignoreDomains
  chrome.storage.local.get('ignoreDomains', function (data) {
    console.log({ GOT: data })
    if (Array.isArray(data.ignoreDomains)) {
      ignoreDomains = data.ignoreDomains
    }
  })

  loadLocalTabStorage()

  eternalIconUpdateLoop()

  console.log("detektIIIF (re)started")

}())
