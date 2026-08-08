'use strict';

const DEFAULT_JD_SERVER = 'http://192.168.1.102:9666';
const SERVER_KEY = 'jdownloaderServer';
const ENABLED_KEY = 'enabled';

const pending = new Map();
const queue = [];
let activeToken = null;
let openingChooser = false;

function isHttpUrl(url) {
  return /^https?:\/\//i.test(url || '');
}

function publicItem(item) {
  return {
    filename: item.filename || '',
    url: item.url || '',
    finalUrl: item.finalUrl || '',
    referrer: item.referrer || '',
    mime: item.mime || '',
    totalBytes: Number(item.totalBytes || 0)
  };
}

function normalizeServerUrl(value) {
  try {
    const parsed = new URL(String(value || '').trim());
    if (!['http:', 'https:'].includes(parsed.protocol)) return DEFAULT_JD_SERVER;
    parsed.pathname = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  } catch (_) {
    return DEFAULT_JD_SERVER;
  }
}

async function getJDownloaderServer() {
  const result = await chrome.storage.local.get({[SERVER_KEY]: DEFAULT_JD_SERVER});
  return normalizeServerUrl(result[SERVER_KEY]);
}

async function getEnabled() {
  const result = await chrome.storage.local.get({[ENABLED_KEY]: true});
  return Boolean(result[ENABLED_KEY]);
}

async function applyActionState(enabled) {
  await chrome.action.setBadgeText({text: enabled ? 'ON' : 'OFF'});
  await chrome.action.setBadgeBackgroundColor({color: enabled ? '#2da44e' : '#6e7781'});
  await chrome.action.setTitle({
    title: enabled
      ? 'JDownloader Download Interceptor — ON (ask for each download)'
      : 'JDownloader Download Interceptor — OFF (browser downloads normally)'
  });
}

async function setEnabled(enabled) {
  await chrome.storage.local.set({[ENABLED_KEY]: Boolean(enabled)});
  await applyActionState(Boolean(enabled));
}

function suggestOnce(entry) {
  if (!entry || entry.suggested) return;
  entry.suggested = true;
  entry.suggest();
}

async function eraseDownload(id) {
  try {
    await chrome.downloads.erase({id});
  } catch (_) {}
}

function cancelOriginal(entry) {
  // Chromium requires onDeterminingFilename listeners to call suggest exactly once.
  // Resolve filename determination, then immediately cancel the original browser
  // download. This mirrors the pattern used by download-manager integrations.
  suggestOnce(entry);
  void chrome.downloads.cancel(entry.item.id)
    .then(() => eraseDownload(entry.item.id))
    .catch(error => console.warn('Could not cancel routed download:', error?.message || error));
}

async function sendToJDownloader(item) {
  const url = item.finalUrl || item.url;
  if (!isHttpUrl(url)) {
    throw new Error('This download does not have an HTTP/HTTPS URL that can be sent to JDownloader.');
  }

  const server = await getJDownloaderServer();
  const body = new URLSearchParams();
  body.set('urls', url);
  body.set('description', 'Sent by JDownloader Download Interceptor');
  body.set('autostart', '1');
  if (item.referrer) body.set('referer', item.referrer);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500);

  try {
    const response = await fetch(`${server}/flashgot`, {
      method: 'POST',
      headers: {'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'},
      body: body.toString(),
      credentials: 'omit',
      signal: controller.signal
    });

    const text = await response.text();
    if (!response.ok || /^failed\s*$/i.test(text.trim())) {
      throw new Error(`JDownloader request failed (HTTP ${response.status}).`);
    }
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`JDownloader is unreachable at ${server}. You can use the browser download instead.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function openChooser(token) {
  const win = await chrome.windows.create({
    url: chrome.runtime.getURL(`chooser.html?id=${encodeURIComponent(token)}`),
    type: 'popup',
    width: 500,
    height: 355,
    focused: true
  });
  if (!win?.id) throw new Error('The download choice window could not be opened.');
  return win.id;
}

function finishEntry(token) {
  const entry = pending.get(token);
  if (!entry) return;
  pending.delete(token);
  if (activeToken === token) activeToken = null;
}

async function showNextChooser() {
  if (activeToken || openingChooser) return;
  if (!(await getEnabled())) return;

  openingChooser = true;
  try {
    while (queue.length && !activeToken) {
      const token = queue.shift();
      const entry = pending.get(token);
      if (!entry || entry.suggested) continue;

      try {
        const windowId = await openChooser(token);
        entry.windowId = windowId;
        activeToken = token;
      } catch (error) {
        console.error('Chooser could not be opened:', error);
        // Never strand a browser download if our UI fails.
        suggestOnce(entry);
        finishEntry(token);
      }
    }
  } finally {
    openingChooser = false;
  }
}

async function releaseAllToBrowser() {
  const active = activeToken ? pending.get(activeToken) : null;

  // Queued items have no window, so release them immediately to the browser.
  for (const [token, entry] of pending) {
    if (token === activeToken) continue;
    suggestOnce(entry);
    pending.delete(token);
  }
  queue.length = 0;

  if (!active) {
    activeToken = null;
    return;
  }

  // Close the chooser first; onRemoved then releases the active item to the
  // browser. This avoids showing the native Save As dialog behind our popup.
  active.closeAction = 'browser';
  if (active.windowId) {
    try {
      await chrome.windows.remove(active.windowId);
      return;
    } catch (_) {}
  }

  suggestOnce(active);
  finishEntry(activeToken);
}

function handleDownload(item, suggest) {
  const entry = {
    token: `${item.id}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    item,
    suggest,
    suggested: false,
    windowId: null,
    closeAction: null
  };

  void (async () => {
    try {
      const enabled = await getEnabled();
      const url = item.finalUrl || item.url;

      if (!enabled || !isHttpUrl(url) || item.byExtensionId === chrome.runtime.id) {
        suggestOnce(entry);
        return;
      }

      pending.set(entry.token, entry);
      queue.push(entry.token);
      await showNextChooser();
    } catch (error) {
      console.error('Interception failed:', error);
      suggestOnce(entry);
      pending.delete(entry.token);
    }
  })();

  // Chromium supports asynchronous suggest() calls when the listener returns
  // true. Until suggest() runs, filename determination remains pending.
  return true;
}

chrome.downloads.onDeterminingFilename.addListener(handleDownload);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message?.type) return undefined;

  void (async () => {
    const token = String(message.id || '');
    const entry = pending.get(token);

    if (message.type === 'get-pending') {
      sendResponse({ok: true, pending: entry ? publicItem(entry.item) : null});
      return;
    }

    if (!entry) {
      sendResponse({ok: false, error: 'This download is no longer waiting for a choice.'});
      return;
    }

    if (message.type === 'choose-browser') {
      entry.closeAction = 'browser';
      sendResponse({ok: true});
      return;
    }

    if (message.type === 'choose-cancel') {
      entry.closeAction = 'cancel';
      sendResponse({ok: true});
      return;
    }

    if (message.type === 'choose-jdownloader') {
      await sendToJDownloader(entry.item);
      entry.closeAction = 'jdownloader';
      sendResponse({ok: true});
      return;
    }

    sendResponse({ok: false, error: 'Unknown action.'});
  })().catch(error => {
    console.error(error);
    sendResponse({ok: false, error: error.message || String(error)});
  });

  return true;
});

chrome.windows.onRemoved.addListener(windowId => {
  void (async () => {
    if (!activeToken) return;
    const token = activeToken;
    const entry = pending.get(token);
    if (!entry || entry.windowId !== windowId) return;

    const action = entry.closeAction || 'browser';

    if (action === 'browser') {
      // Continue the ORIGINAL browser download. No URL reconstruction, no second
      // chrome.downloads.download() call, so cookies/POST/request state stay intact.
      suggestOnce(entry);
    } else {
      // JDownloader already accepted the URL (or the user explicitly chose
      // cancel). Resolve the event and immediately cancel the original download.
      cancelOriginal(entry);
    }

    finishEntry(token);
    await showNextChooser();
  })();
});

chrome.action.onClicked.addListener(() => {
  void (async () => {
    const enabled = await getEnabled();
    const next = !enabled;
    await setEnabled(next);
    if (!next) await releaseAllToBrowser();
  })();
});

chrome.runtime.onInstalled.addListener(() => {
  void (async () => {
    const current = await chrome.storage.local.get([ENABLED_KEY, SERVER_KEY]);
    const enabled = typeof current[ENABLED_KEY] === 'boolean' ? current[ENABLED_KEY] : true;

    const updates = {};
    if (typeof current[ENABLED_KEY] !== 'boolean') updates[ENABLED_KEY] = true;
    if (!current[SERVER_KEY]) updates[SERVER_KEY] = DEFAULT_JD_SERVER;
    if (Object.keys(updates).length) await chrome.storage.local.set(updates);

    await applyActionState(enabled);
  })();
});

chrome.runtime.onStartup.addListener(() => {
  void getEnabled().then(applyActionState);
});

void getEnabled().then(applyActionState);
