"use strict";

const STATIC_CACHE = "usabo-practical-static-v4";
const RUNTIME_CACHE = "usabo-practical-runtime-v4";
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./assets/site.css",
  "./assets/bioinfo-app.js",
  "./assets/ml-tools.js",
  "./assets/bioinfo-runtime.sharedworker.js",
  "./assets/biopython-tools.js",
  "./assets/py/biotools.py",
  "./assets/clustalo-tools.js",
  "./assets/vendor/clustalo/clustalo.js",
  "./assets/vendor/clustalo/clustalo.wasm",
  "./camp-resources/",
  "./camp-resources/ibo-bioinformatics-tools/",
  "./camp-resources/machine-learning-tools/"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    await cache.addAll(CORE_ASSETS);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => ![STATIC_CACHE, RUNTIME_CACHE].includes(key)).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && (response.ok || response.type === "opaque")) {
    cache.put(request, response.clone());
  }
  return response;
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request).then((response) => {
    if (response && (response.ok || response.type === "opaque")) cache.put(request, response.clone());
    return response;
  }).catch(() => null);
  return cached || network;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;
  const pyodideCdn = url.hostname === "cdn.jsdelivr.net" && url.pathname.includes("/pyodide/");

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, STATIC_CACHE));
    return;
  }

  if (sameOrigin && (url.pathname.endsWith(".wasm") || url.pathname.includes("/assets/vendor/") || url.pathname.includes("/assets/py/"))) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  if (sameOrigin && url.pathname.includes("/assets/")) {
    event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
    return;
  }

  if (pyodideCdn) {
    event.respondWith(cacheFirst(request, RUNTIME_CACHE));
  }
});
