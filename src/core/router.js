// core/router.js — tiny method+path router (§4.3)
import { checkBody } from './inputs.js';

export class Router {
  constructor() {
    this.routes = [];
  }

  get(path, handler) {
    this.routes.push({ method: 'GET', path, handler });
    return this;
  }

  post(path, handler) {
    this.routes.push({ method: 'POST', path, handler });
    return this;
  }

  put(path, handler) {
    this.routes.push({ method: 'PUT', path, handler });
    return this;
  }

  delete(path, handler) {
    this.routes.push({ method: 'DELETE', path, handler });
    return this;
  }

  async handle(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    for (const route of this.routes) {
      if (route.method !== method) continue;
      const match = matchPath(route.path, path);
      if (match) {
        request.params = match.params;
        // Every JSON body is checked once here (core/inputs.js) before the route reads it. Lead webhooks from ad platforms are
        // left as sent (their signature covers the raw text, and the lead route cleans each field itself).
        if ((method === 'POST' || method === 'PUT') && !path.startsWith('/api/webhooks/') && /application\/json/i.test(request.headers.get('content-type') || '')
          && Number(request.headers.get('content-length') || 0) <= 1048576) {   // bigger bodies are refused by withAuth as too large
          const text = await request.clone().text();
          if (text.trim()) {
            let parsed;
            try { parsed = JSON.parse(text); } catch (e) { parsed = undefined; }
            // text that is not JSON goes on to the route, which answers it as before (too large, or could not be read)
            const r = parsed === undefined ? { body: undefined } : checkBody(parsed);
            if (r.error) return Response.json({ ok: false, error: r.error, code: 'bad_input' }, { status: 400 });
            if (r.body !== undefined) { const clean = JSON.stringify(r.body); request.json = async () => JSON.parse(clean); }
          }
        }
        return route.handler(request, env, match.params);
      }
    }

    return Response.json({ ok: false, error: 'Not found' }, { status: 404 });
  }
}

function matchPath(pattern, path) {
  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = path.split('/').filter(Boolean);
  if (patternParts.length !== pathParts.length) return null;
  const params = {};
  for (let i = 0; i < patternParts.length; i++) {
    const p = patternParts[i];
    if (p.startsWith(':') && p.length > 1) {
      params[p.slice(1)] = pathParts[i];
    } else if (p !== pathParts[i]) {
      return null;
    }
  }
  return { params };
}
