const HOST_NAME = 'com.gatheros.app';
let port = null;
let reconnectTimer = null;

function connect() {
  if (port) return;
  try {
    port = chrome.runtime.connectNative(HOST_NAME);
  } catch (err) {
    console.warn('[gatheros] connectNative failed:', err.message);
    scheduleReconnect();
    return;
  }

  port.onMessage = (msg) => {
    console.log('[gatheros] native response:', msg);
  };

  port.onDisconnect = () => {
    const err = chrome.runtime.lastError;
    console.warn('[gatheros] native disconnected:', err ? err.message : 'unknown');
    port = null;
    scheduleReconnect();
  };
}

function scheduleReconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, 3000);
}

connect();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== 'drop-url') return false;
  if (!port) {
    sendResponse({ ok: false, error: 'not connected to native host' });
    return false;
  }

  port.postMessage({ type: 'drop-url', urls: message.urls });

  port.onMessage = (response) => {
    sendResponse(response);
    port.onMessage = null;
  };

  return true;
});
