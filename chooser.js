'use strict';

const params = new URLSearchParams(location.search);
const id = params.get('id') || '';

const filenameEl = document.getElementById('filename');
const detailsEl = document.getElementById('details');
const errorEl = document.getElementById('error');
const statusEl = document.getElementById('status');
const buttons = [...document.querySelectorAll('button')];

function send(type) {
  return chrome.runtime.sendMessage({type, id});
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

function basename(path) {
  if (!path) return 'Download';
  return path.split(/[\\/]/).pop() || path;
}

function setBusy(text) {
  buttons.forEach(button => { button.disabled = true; });
  statusEl.textContent = text;
  errorEl.hidden = true;
}

function clearBusy() {
  buttons.forEach(button => { button.disabled = false; });
  statusEl.textContent = '';
}

function showError(message) {
  clearBusy();
  errorEl.textContent = message;
  errorEl.hidden = false;
}

async function choose(type, busyText) {
  setBusy(busyText);
  try {
    const result = await send(type);
    if (!result?.ok) {
      showError(result?.error || 'The action failed.');
      return;
    }
    window.close();
  } catch (error) {
    showError(error.message || String(error));
  }
}

send('get-pending').then(result => {
  if (!result?.pending) {
    showError('Download information is no longer available.');
    return;
  }

  const item = result.pending;
  filenameEl.textContent = basename(item.filename);

  const parts = [];
  const size = formatBytes(item.totalBytes);
  if (size) parts.push(size);
  try {
    const host = new URL(item.finalUrl || item.url).hostname;
    if (host) parts.push(host);
  } catch (_) {}
  detailsEl.textContent = parts.join(' • ');
}).catch(error => showError(error.message || String(error)));

document.getElementById('jd').addEventListener('click', () => {
  void choose('choose-jdownloader', 'Sending to JDownloader…');
});

document.getElementById('browser').addEventListener('click', () => {
  void choose('choose-browser', 'Continuing browser download…');
});

document.getElementById('cancel').addEventListener('click', () => {
  void choose('choose-cancel', 'Cancelling download…');
});
