/* 5.8 MCP 客户端（window.Mcp）：远程 MCP 服务器，Streamable HTTP 传输（2025-06-18 版协议）。
 * - 请求都用 XHR：App 从 file:///android_asset 打开，WebView 开了 allowUniversalAccessFromFileURLs，XHR 不受跨域限制。
 * - 一个服务器一个 Client：initialize → notifications/initialized → tools/list（翻页）→ tools/call。
 *   服务器回 JSON 或 SSE（text/event-stream）都能读；有 Mcp-Session-Id 就带上，会话过期（404）自动重新握手一次。
 * - 登录：先看服务器的 401 → 受保护资源元数据 → 授权服务器元数据 → 动态注册客户端 → PKCE 授权码 → 换 token / 刷新 token。
 * - 目录：registry.modelcontextprotocol.io 官方 MCP 目录搜索。
 * 这里不存任何 Key / Token：凭据由 index.html 的连接器模块保存在手机本地，调用时传进来。
 */
(function () {
  'use strict';
  var M = {}, PROTO = '2025-06-18', REDIRECT = 'com.cloudweather.xiaoyu://oauth';
  M.PROTO = PROTO; M.REDIRECT = REDIRECT;

  function host(u) { try { return new URL(u).host; } catch (e) { return u; } }
  function req(method, url, headers, body, timeout) {
    return new Promise(function (res, rej) {
      var x = new XMLHttpRequest();
      try { x.open(method, url, true); } catch (e) { rej({ msg: '网址不对：' + url }); return; }
      Object.keys(headers || {}).forEach(function (k) { if (headers[k] != null && headers[k] !== '') x.setRequestHeader(k, headers[k]); });
      x.timeout = timeout || 60000;
      x.onload = function () {
        res({ status: x.status, text: x.responseText || '', h: function (n) { try { return x.getResponseHeader(n) || ''; } catch (e) { return ''; } } });
      };
      x.onerror = function () { rej({ msg: '连不上 ' + host(url), net: true }); };
      x.ontimeout = function () { rej({ msg: host(url) + ' 太久没回应', net: true }); };
      x.send(body == null ? null : body);
    });
  }
  M.req = req;

  // SSE：把 data: 行拼起来，每个事件解析成 JSON
  function sseMessages(text) {
    var out = [];
    String(text).split(/\r?\n\r?\n/).forEach(function (ev) {
      var data = ev.split(/\r?\n/).filter(function (l) { return /^data:/.test(l); }).map(function (l) { return l.replace(/^data: ?/, ''); }).join('\n');
      if (!data) return;
      try { out.push(JSON.parse(data)); } catch (e) {}
    });
    return out;
  }
  M.sse = sseMessages;
  function wwwParam(h, k) { var m = new RegExp(k + '="([^"]+)"').exec(h || ''); return m ? m[1] : ''; }

  function Client(o) {
    this.url = o.url; this.name = o.name || host(o.url);
    this.headers = o.headers || function () { return {}; };   // 每次请求时调用，拿到最新的 Authorization
    this.onAuth = o.onAuth || null;                            // 401 时调用（刷新 token），成功后重试一次
    this.sid = ''; this.seq = 0; this.ready = null; this.info = null; this.tools = null;
  }
  Client.prototype.post = function (msg, retried) {
    var me = this, h = { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream', 'MCP-Protocol-Version': PROTO };
    var extra = me.headers() || {}; Object.keys(extra).forEach(function (k) { h[k] = extra[k]; });
    if (me.sid) h['Mcp-Session-Id'] = me.sid;
    return req('POST', me.url, h, JSON.stringify(msg), msg.method === 'tools/call' ? 120000 : 45000).then(function (r) {
      var sid = r.h('mcp-session-id'); if (sid) me.sid = sid;
      if (r.status === 401 || r.status === 403) {
        var www = r.h('www-authenticate');
        if (r.status === 401 && me.onAuth && !retried) return me.onAuth(www).then(function (ok) { if (!ok) throw { msg: me.name + ' 要重新登录', auth: true, www: www }; return me.post(msg, true); });
        throw { msg: r.status === 401 ? me.name + ' 要登录（或 Token 不对）' : me.name + ' 拒绝了这次访问（权限不够）', auth: r.status === 401, status: r.status, www: www };
      }
      if (r.status === 404 && me.sid && !retried && msg.method !== 'initialize') {   // 会话过期：重新握手
        me.sid = ''; me.ready = null;
        return me.init().then(function () { return me.post(msg, true); });
      }
      if (r.status === 202 || r.status === 204) return null;
      if (r.status < 200 || r.status >= 300) {
        var em = ''; try { var ej = JSON.parse(r.text); em = (ej.error && (ej.error.message || ej.error)) || ej.message || ''; } catch (e) { em = r.text.slice(0, 160); }
        throw { msg: me.name + ' 出错了（' + r.status + (em ? '：' + String(em).slice(0, 160) : '') + '）', status: r.status };
      }
      if (msg.id == null) return null;
      var ct = r.h('content-type'), list = /event-stream/.test(ct) || /^\s*(event|data|id):/m.test(r.text) && !/^\s*[\[{]/.test(r.text) ? sseMessages(r.text) : [];
      if (!list.length) { try { var j = JSON.parse(r.text); list = Array.isArray(j) ? j : [j]; } catch (e) { throw { msg: me.name + ' 回的内容看不懂' }; } }
      var hit = list.filter(function (x) { return x && x.id === msg.id && (x.result !== undefined || x.error); })[0];
      if (!hit) throw { msg: me.name + ' 没有回应这次请求' };
      if (hit.error) throw { msg: me.name + '：' + (hit.error.message || '出错了') + (hit.error.code ? '（' + hit.error.code + '）' : ''), rpc: hit.error.code };
      return hit.result;
    });
  };
  Client.prototype.call_ = function (method, params) { return this.post({ jsonrpc: '2.0', id: ++this.seq, method: method, params: params || {} }); };
  Client.prototype.init = function () {
    var me = this;
    if (me.ready) return me.ready;
    me.ready = me.call_('initialize', { protocolVersion: PROTO, capabilities: {}, clientInfo: { name: 'yunduo-amor', title: '云朵天气 · Amor', version: '5.8' } }).then(function (r) {
      me.info = r || {};
      return me.post({ jsonrpc: '2.0', method: 'notifications/initialized' }).catch(function () {}).then(function () { return me.info; });
    });
    me.ready.catch(function () { me.ready = null; });
    return me.ready;
  };
  Client.prototype.listTools = function () {
    var me = this, all = [];
    function page(cursor, n) {
      return me.call_('tools/list', cursor ? { cursor: cursor } : {}).then(function (r) {
        all = all.concat((r && r.tools) || []);
        return r && r.nextCursor && n < 10 ? page(r.nextCursor, n + 1) : all;
      });
    }
    return me.init().then(function () { return page('', 0); }).then(function (t) { me.tools = t; return t; });
  };
  Client.prototype.callTool = function (name, args) {
    var me = this;
    return me.init().then(function () { return me.call_('tools/call', { name: name, arguments: args || {} }); }).then(resultText);
  };
  M.Client = Client;

  function resultText(r) {
    r = r || {};
    var parts = (r.content || []).map(function (c) {
      if (!c) return '';
      if (c.type === 'text') return c.text || '';
      if (c.type === 'image') return '[图片 ' + (c.mimeType || '') + ']';
      if (c.type === 'audio') return '[音频]';
      if (c.type === 'resource') return c.resource ? c.resource.text || '[资源 ' + (c.resource.uri || '') + ']' : '';
      if (c.type === 'resource_link') return '[链接] ' + (c.name ? c.name + ' ' : '') + (c.uri || '');
      return '';
    }).filter(Boolean);
    if (!parts.length && r.structuredContent) parts.push(JSON.stringify(r.structuredContent, null, 1));
    return { text: parts.join('\n\n'), isError: !!r.isError };
  }
  M.resultText = resultText;

  // 工具是不是会改东西：服务器标了 readOnlyHint 就信；没标的按名字猜（get/list/search/read… 当只读）
  M.isWrite = function (t) {
    var a = (t && t.annotations) || {};
    if (a.readOnlyHint === true) return false;
    if (a.readOnlyHint === false || a.destructiveHint === true) return true;
    return !/^(get|list|search|read|fetch|find|query|lookup|describe|show|view|resolve|ask|download|retrieve|check|count|browse|explore|whoami|me)([_\-A-Z]|$)/i.test(t.name || '');
  };

  /* ---------- 登录（OAuth 2.1：受保护资源元数据 + 授权服务器元数据 + 动态注册 + PKCE） ---------- */
  function getJson(url) { return req('GET', url, { Accept: 'application/json' }, null, 20000).then(function (r) { if (r.status !== 200) throw { status: r.status }; return JSON.parse(r.text); }); }
  function firstOk(urls) {
    var i = 0;
    function next() { if (i >= urls.length) return Promise.reject({ msg: 'none' }); var u = urls[i++]; return getJson(u).catch(next); }
    return next();
  }
  function wellKnown(base, name) {   // RFC 8414：有路径时插在 .well-known 后面
    var u = new URL(base), p = u.pathname.replace(/\/$/, '');
    return (p ? [u.origin + '/.well-known/' + name + p] : []).concat([u.origin + '/.well-known/' + name]);
  }
  M.discover = function (mcpUrl, www) {
    var rm = wwwParam(www, 'resource_metadata');
    var prm = firstOk((rm ? [rm] : []).concat(wellKnown(mcpUrl, 'oauth-protected-resource'))).catch(function () { return null; });
    return prm.then(function (pr) {
      var as = pr && pr.authorization_servers && pr.authorization_servers[0] || new URL(mcpUrl).origin;
      return firstOk(wellKnown(as, 'oauth-authorization-server').concat(wellKnown(as, 'openid-configuration'))).catch(function () {
        var o = new URL(as).origin; return { issuer: o, authorization_endpoint: o + '/authorize', token_endpoint: o + '/token', registration_endpoint: o + '/register', guessed: true };
      }).then(function (meta) { meta.resource = pr && pr.resource || mcpUrl; meta.scopes = pr && pr.scopes_supported || meta.scopes_supported || null; return meta; });
    });
  };
  M.register = function (meta, name) {
    if (!meta.registration_endpoint) return Promise.reject({ msg: '这个服务不支持自动注册，得在它的网站上手动建一个应用' });
    return req('POST', meta.registration_endpoint, { 'Content-Type': 'application/json', Accept: 'application/json' }, JSON.stringify({
      client_name: name || '云朵天气 · Amor', redirect_uris: [REDIRECT], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none'
    }), 20000).then(function (r) {
      if (r.status < 200 || r.status >= 300) throw { msg: '注册客户端失败（' + r.status + '）' + r.text.slice(0, 120) };
      var j = JSON.parse(r.text); if (!j.client_id) throw { msg: '注册客户端失败（没有 client_id）' };
      return { client_id: j.client_id, client_secret: j.client_secret || '' };
    });
  };
  function b64url(u8) { var s = ''; for (var i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function rand(n) { var u = new Uint8Array(n); crypto.getRandomValues(u); return b64url(u); }
  M.authUrl = function (meta, client) {
    var verifier = rand(48), state = rand(16);
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)).then(function (h) {
      var q = { response_type: 'code', client_id: client.client_id, redirect_uri: REDIRECT, code_challenge: b64url(new Uint8Array(h)), code_challenge_method: 'S256', state: state, resource: meta.resource };
      if (meta.scopes && meta.scopes.length) q.scope = meta.scopes.join(' ');
      var u = meta.authorization_endpoint + (meta.authorization_endpoint.indexOf('?') >= 0 ? '&' : '?') + Object.keys(q).map(function (k) { return k + '=' + encodeURIComponent(q[k]); }).join('&');
      return { url: u, verifier: verifier, state: state };
    });
  };
  function form(o) { return Object.keys(o).filter(function (k) { return o[k] != null && o[k] !== ''; }).map(function (k) { return k + '=' + encodeURIComponent(o[k]); }).join('&'); }
  function tokenReq(meta, body) {
    return req('POST', meta.token_endpoint, { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, form(body), 20000).then(function (r) {
      var j = {}; try { j = JSON.parse(r.text); } catch (e) {}
      if (r.status < 200 || r.status >= 300 || !j.access_token) throw { msg: '换取登录凭据失败（' + r.status + (j.error ? '：' + (j.error_description || j.error) : '') + '）' };
      return { access: j.access_token, refresh: j.refresh_token || body.refresh_token || '', exp: j.expires_in ? Date.now() + j.expires_in * 1000 - 60000 : 0 };
    });
  }
  M.exchange = function (meta, client, code, verifier) {
    return tokenReq(meta, { grant_type: 'authorization_code', code: code, redirect_uri: REDIRECT, client_id: client.client_id, client_secret: client.client_secret, code_verifier: verifier, resource: meta.resource });
  };
  M.refresh = function (meta, client, refresh) {
    return tokenReq(meta, { grant_type: 'refresh_token', refresh_token: refresh, client_id: client.client_id, client_secret: client.client_secret, resource: meta.resource });
  };

  /* ---------- 官方 MCP 目录 ---------- */
  M.REGISTRY = 'https://registry.modelcontextprotocol.io/v0/servers';
  M.search = function (q, limit) {
    return req('GET', M.REGISTRY + '?limit=' + (limit || 30) + '&search=' + encodeURIComponent(q || ''), { Accept: 'application/json' }, null, 20000).then(function (r) {
      if (r.status !== 200) throw { msg: 'MCP 目录暂时打不开（' + r.status + '）' };
      var j = JSON.parse(r.text), seen = {};
      return (j.servers || []).map(function (s) { return s && s.server ? s.server : s; }).filter(function (s) {
        var latest = s._meta && s._meta['io.modelcontextprotocol.registry/official'];
        if (latest && latest.isLatest === false) return false;
        if (seen[s.name]) return false; seen[s.name] = 1; return true;
      }).map(function (s) {
        var rem = (s.remotes || []).filter(function (x) { return x.type === 'streamable-http' && /^https:/.test(x.url || ''); })[0] || null;
        var need = rem ? (rem.headers || []).filter(function (h) { return h.isRequired; }).map(function (h) { return h.name; }) : [];
        return { name: s.name, title: s.title || s.name.split('/').pop(), desc: s.description || '', url: rem ? rem.url : '', remote: !!rem, needs: need,
          open: !!rem && !need.length && !/\{[^}]+\}/.test(rem.url), site: s.websiteUrl || (s.repository && s.repository.url) || '' };
      });
    });
  };

  window.Mcp = M;
})();
