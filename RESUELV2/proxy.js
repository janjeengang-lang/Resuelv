/**
 * proxy.js
 *
 * Provides a unified interface for configuring proxies. HTTP/HTTPS
 * proxies continue to use the Chrome proxy settings and
 * `onAuthRequired` flow. SOCKS5 proxies are handled via a native
 * messaging host that opens authenticated tunnels on behalf of the
 * extension. This avoids relying on the deprecated SOCKS handling of
 * `chrome.proxy.settings`.
 */

const AUTH_LISTENER_KEY = Symbol('authListener');

/**
 * Configure a proxy. Passing `null` clears any existing proxy
 * configuration. Supported schemes: `http`, `https`, `socks5`.
 *
 * @param {Object|null} proxy - Proxy configuration.
 * @param {string} proxy.scheme - Proxy scheme (http, https, socks5).
 * @param {string} proxy.host - Proxy host name or IP.
 * @param {number} proxy.port - Proxy port.
 * @param {string} [proxy.username] - Optional username.
 * @param {string} [proxy.password] - Optional password.
 * @param {string} [proxy.destHost] - Destination host for SOCKS tunnel.
 * @param {number} [proxy.destPort] - Destination port for SOCKS tunnel.
 */
self.configureProxy = async function configureProxy(proxy) {
  if (!proxy) {
    await clearProxy();
    return;
  }

  const scheme = proxy.scheme?.toLowerCase();
  if (scheme === 'socks5') {
    // Remove any previous Chrome proxy configuration before opening the
    // tunnel so normal traffic is unaffected.
    await clearProxy();
    await openSocksTunnel(proxy);
    return;
  }

  await setupChromeProxy(proxy);
};

async function setupChromeProxy({ scheme, host, port, username, password }) {
  const config = {
    mode: 'fixed_servers',
    rules: {
      singleProxy: { scheme, host, port: parseInt(port, 10) }
    }
  };
  chrome.proxy.settings.set({ value: config, scope: 'regular' });

  if (username || password) {
    const listener = details => ({
      authCredentials: { username: username || '', password: password || '' }
    });
    chrome.webRequest.onAuthRequired.addListener(
      listener,
      { urls: ['<all_urls>'] },
      ['blocking']
    );
    self[AUTH_LISTENER_KEY] = listener;
  }
}

async function clearProxy() {
  chrome.proxy.settings.clear({ scope: 'regular' });
  const listener = self[AUTH_LISTENER_KEY];
  if (listener && chrome.webRequest.onAuthRequired.hasListener(listener)) {
    chrome.webRequest.onAuthRequired.removeListener(listener);
    delete self[AUTH_LISTENER_KEY];
  }
}

async function openSocksTunnel({ host, port, username, password, destHost, destPort }) {
  const message = {
    type: 'OPEN_SOCKS_TUNNEL',
    proxy: { host, port, username, password },
    destination: { host: destHost, port: destPort }
  };
  try {
    await chrome.runtime.sendNativeMessage('com.resuelv.socks', message);
  } catch (err) {
    console.error('SOCKS tunnel failed', err);
  }
}
