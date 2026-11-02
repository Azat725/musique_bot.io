/** Global subscriptions belong to the cached view, and end when navigation discards it. */
export function viewScope(root) {
  const controller = new AbortController();
  const cleanups = [];
  root.dispose = () => { root.disposed = true; controller.abort(); cleanups.splice(0).forEach((fn) => fn?.()); };
  return {
    listen(target, event, fn) { target.addEventListener(event, fn, { signal: controller.signal }); },
    keep(fn) { cleanups.push(fn); },
  };
}
