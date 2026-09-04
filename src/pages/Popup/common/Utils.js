/*global chrome*/
export function getCurrentTab(callback) {
    const params = new URLSearchParams(window.location.search);
    const tabId = parseInt(params.get('tabId'), 10);

    if (!Number.isNaN(tabId)) {
        chrome.tabs.get(tabId, (tab) => {
            if (!chrome.runtime.lastError && tab) {
                callback(tab);
                return;
            }

            queryActiveTab(callback);
        });
        return;
    }

    queryActiveTab(callback);
}

function queryActiveTab(callback) {
    chrome.tabs.query({
        active: true,
        currentWindow: true
    },
    (tabs) => {
        callback(tabs[0]);
    });
}
