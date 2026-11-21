// Tiny in-process event bus: emit(name, payload) / on(name, handler)
// Modules announce events here; other modules subscribe. Modules never import each other.

const handlers = new Map();

export function on(name, handler) {
  if (!handlers.has(name)) handlers.set(name, []);
  handlers.get(name).push(handler);
}

export function emit(name, payload) {
  const list = handlers.get(name);
  if (!list) return;
  for (const handler of list) {
    try {
      handler(payload);
    } catch (e) {
      // A failing subscriber never breaks the emitter
    }
  }
}