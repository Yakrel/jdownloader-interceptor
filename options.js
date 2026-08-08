'use strict';

const DEFAULT_SERVER = 'http://192.168.1.102:9666';
const SERVER_KEY = 'jdownloaderServer';

const serverInput = document.getElementById('server');
const saveButton = document.getElementById('save');
const resetButton = document.getElementById('reset');
const errorEl = document.getElementById('error');
const successEl = document.getElementById('success');

function normalizeServer(value) {
  const parsed = new URL(String(value || '').trim());
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('The server URL must use http:// or https://.');
  }
  if (parsed.username || parsed.password) {
    throw new Error('Do not include a username or password in the server URL.');
  }
  if ((parsed.pathname && parsed.pathname !== '/') || parsed.search || parsed.hash) {
    throw new Error('Enter only the base server URL, for example http://192.168.1.102:9666.');
  }
  parsed.pathname = '';
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

function hostPermissionPattern(server) {
  const parsed = new URL(server);
  return `${parsed.protocol}//${parsed.hostname}/*`;
}

function showError(message) {
  successEl.hidden = true;
  errorEl.textContent = message;
  errorEl.hidden = false;
}

function showSuccess(message) {
  errorEl.hidden = true;
  successEl.textContent = message;
  successEl.hidden = false;
}

async function loadSettings() {
  const result = await chrome.storage.local.get({[SERVER_KEY]: DEFAULT_SERVER});
  serverInput.value = result[SERVER_KEY] || DEFAULT_SERVER;
}

async function saveServer(rawValue) {
  const server = normalizeServer(rawValue);
  const newPattern = hostPermissionPattern(server);
  const defaultPattern = hostPermissionPattern(DEFAULT_SERVER);

  // Request optional host access immediately from the Save button's user gesture.
  if (newPattern !== defaultPattern) {
    const granted = await chrome.permissions.request({origins: [newPattern]});
    if (!granted) {
      throw new Error('Host access was not granted, so the server setting was not changed.');
    }
  }

  const current = await chrome.storage.local.get({[SERVER_KEY]: DEFAULT_SERVER});
  const oldServer = normalizeServer(current[SERVER_KEY] || DEFAULT_SERVER);
  const oldPattern = hostPermissionPattern(oldServer);

  await chrome.storage.local.set({[SERVER_KEY]: server});

  if (oldPattern !== newPattern && oldPattern !== defaultPattern) {
    try {
      await chrome.permissions.remove({origins: [oldPattern]});
    } catch (_) {}
  }

  serverInput.value = server;
  return server;
}

saveButton.addEventListener('click', () => {
  void (async () => {
    saveButton.disabled = true;
    resetButton.disabled = true;
    try {
      const server = await saveServer(serverInput.value);
      showSuccess(`Saved. Downloads sent to JDownloader will use ${server}.`);
    } catch (error) {
      showError(error.message || String(error));
    } finally {
      saveButton.disabled = false;
      resetButton.disabled = false;
    }
  })();
});

resetButton.addEventListener('click', () => {
  void (async () => {
    saveButton.disabled = true;
    resetButton.disabled = true;
    try {
      const current = await chrome.storage.local.get({[SERVER_KEY]: DEFAULT_SERVER});
      const oldServer = normalizeServer(current[SERVER_KEY] || DEFAULT_SERVER);
      const oldPattern = hostPermissionPattern(oldServer);
      const defaultPattern = hostPermissionPattern(DEFAULT_SERVER);

      await chrome.storage.local.set({[SERVER_KEY]: DEFAULT_SERVER});
      serverInput.value = DEFAULT_SERVER;

      if (oldPattern !== defaultPattern) {
        try {
          await chrome.permissions.remove({origins: [oldPattern]});
        } catch (_) {}
      }

      showSuccess(`Reset to ${DEFAULT_SERVER}.`);
    } catch (error) {
      showError(error.message || String(error));
    } finally {
      saveButton.disabled = false;
      resetButton.disabled = false;
    }
  })();
});

void loadSettings().catch(error => showError(error.message || String(error)));
