// [skill: go-team-standards · dev-dna] 提供同源 PWA 应用壳缓存与显式更新
"use strict";

const CACHE_NAME = "go-interview-v5";
const APP_SHELL = Object.freeze([
  "./",
  "./index.html",
  "./assets/styles.css",
  "./assets/app.js",
  "./data/questions.js",
  "./manifest.webmanifest",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/icons/icon-maskable-512.png"
]);
const STATIC_DESTINATIONS = new Set([
  "font",
  "image",
  "manifest",
  "script",
  "style"
]);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => notifyUpdateReady())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => Promise.all(
        cacheNames
          .filter((cacheName) => (
            cacheName.startsWith("go-interview-")
            && cacheName !== CACHE_NAME
          ))
          .map((cacheName) => caches.delete(cacheName))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (!STATIC_DESTINATIONS.has(request.destination)) {
    return;
  }
  event.respondWith(cacheFirst(request));
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

async function networkFirstNavigation(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    return await fetch(request);
  } catch (error) {
    const fallback = await cache.match("./index.html");
    if (fallback) {
      return fallback;
    }
    throw error;
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) {
    return cached;
  }

  const response = await fetch(request);
  if (response && response.ok) {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  }
  return response;
}

async function notifyUpdateReady() {
  if (!self.registration.active) {
    return;
  }

  const windowClients = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true
  });
  windowClients.forEach((client) => {
    client.postMessage({
      type: "UPDATE_READY",
      cacheName: CACHE_NAME
    });
  });
}
