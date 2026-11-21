// core/router.js — tiny method+path router (§4.3)

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
