/** Jednostavan predmemorijski sloj po korisniku i ključu, s rokom trajanja. */
const store = new Map();

export function cached(key, ttlMs, loader, { refresh = false } = {}) {
  const hit = store.get(key);
  if (!refresh && hit && hit.expires > Date.now()) return hit.promise;

  const promise = loader().catch((e) => {
    store.delete(key); // neuspjeh se ne pamti
    throw e;
  });
  store.set(key, { promise, expires: Date.now() + ttlMs, storedAt: Date.now() });
  return promise;
}

export const storedAt = (key) => store.get(key)?.storedAt ?? Date.now();

export function drop(prefix) {
  for (const k of store.keys()) if (k.startsWith(prefix)) store.delete(k);
}
