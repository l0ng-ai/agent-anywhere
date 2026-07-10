// Wire the daemon's outbound HTTP and WebSocket through the system proxy.
//
// undici `fetch` (the request backend of @cordisjs/plugin-http) and the `ws`
// package (its ws() backend) do NOT read HTTP_PROXY/HTTPS_PROXY automatically.
// Even if the shell has a proxy and curl works, the daemon connects directly →
// ETIMEDOUT reaching Discord etc. behind a firewall. This patches both outbound
// paths once when the Context is built.
import { ProxyAgent, setGlobalDispatcher } from 'undici';
import { HttpsProxyAgent } from 'https-proxy-agent';
import type { Context } from '@satorijs/core';

/** Read the proxy URL from common env vars (any case; HTTPS > HTTP > ALL). undefined if unset. */
export function proxyUrlFromEnv(): string | undefined {
  const e = process.env;
  return (
    e.HTTPS_PROXY ||
    e.https_proxy ||
    e.HTTP_PROXY ||
    e.http_proxy ||
    e.ALL_PROXY ||
    e.all_proxy ||
    undefined
  );
}

/**
 * Strip embedded credentials from a proxy URL before logging it. HTTPS_PROXY/ALL_PROXY commonly
 * carry `http://user:pass@host`; printing it verbatim leaks the credentials to logs. Returns the
 * URL with userinfo masked; falls back to a constant if the URL can't be parsed.
 */
export function redactProxyUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.username || u.password) {
      u.username = '***';
      u.password = '';
    }
    return u.toString();
  } catch {
    return '(unparseable proxy URL, redacted)';
  }
}

// Global undici dispatcher is set once per process; multiple installs don't repeat it.
let globalDispatcherSet = false;

/**
 * Wire outbound proxy on the given Context (reads env; silent no-op if unset).
 * 1) HTTP: setGlobalDispatcher(ProxyAgent) — covers global fetch (incl. Discord gateway/bot fetches).
 * 2) WebSocket: on 'http/websocket-init', inject HttpsProxyAgent into ws options
 *    (CONNECT tunnel for wss target + http proxy). The event fires only when
 *    plugin-http uses the non-native WebSocket (the `ws` package), always true here.
 */
export function installProxy(ctx: Context): void {
  const url = proxyUrlFromEnv();
  if (!url) return;

  if (!globalDispatcherSet) {
    setGlobalDispatcher(new ProxyAgent(url));
    globalDispatcherSet = true;
    console.log(`[proxy] routing outbound HTTP/WebSocket through proxy ${redactProxyUrl(url)}`);
  }

  const wsAgent = new HttpsProxyAgent(url);
  // 'http/websocket-init' is a @cordisjs/plugin-http event not declared in
  // @satorijs/core's event table, so we widen `on`'s type here. options looks like
  // { handshakeTimeout, headers }; we just add the agent field.
  (ctx as unknown as {
    on: (name: string, cb: (url: URL, options: Record<string, unknown>) => void) => void;
  }).on('http/websocket-init', (_url, options) => {
    options.agent = wsAgent;
  });
}
