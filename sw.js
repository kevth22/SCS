importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyALS4oLAQZOVCeXANn77JxEzvyA7mfIER0",
  authDomain: "black-white-eagles.firebaseapp.com",
  projectId: "black-white-eagles",
  storageBucket: "black-white-eagles.firebasestorage.app",
  messagingSenderId: "85592070613",
  appId: "1:85592070613:web:da9965f7db7ef77fc7c55c"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(payload => {
  const title = payload.notification?.title || payload.data?.title || "Black White Eagles";

  return self.registration.showNotification(title, {
    body: payload.notification?.body || payload.data?.body || "Neue Mitteilung",
    icon: payload.notification?.icon || payload.data?.icon || "./icon-192.png",
    badge: "./icon-192.png",
    tag: payload.data?.tag || "bwe-push",
    data: {
      url: payload.data?.url || "./index.html"
    }
  });
});

self.addEventListener("notificationclick", event => {
  event.notification.close();

  const targetUrl = new URL(
    event.notification.data?.url || "./index.html",
    self.location.href
  ).href;

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(windowClients => {
      for (const client of windowClients) {
        if ("focus" in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }

      return clients.openWindow(targetUrl);
    })
  );
});

const VERSION = "bwe-v14-tree-entry";

const CORE_FILES = [
  "./",
  "./index.html",
  "./welcome.html",
  "./login.html",
  "./registrieren.html",
  "./style.css?v=11.1",
  "./konto.css?v=11.1",
  "./manifest.json",
  "./pwa.js",
  "./auth-utils.js",
  "./account-ui.js",
  "./index.js",
  "./black-white-eagles-logo.png?v=11.1",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(VERSION).then(async cache => {
      // Eine einzelne fehlende Datei darf die komplette Installation
      // des Service Workers nicht mehr abbrechen.
      await Promise.allSettled(
        CORE_FILES.map(file => cache.add(file))
      );
    })
  );

  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== VERSION)
          .map(key => caches.delete(key))
      )
    )
  );

  self.clients.claim();
});

self.addEventListener("fetch", event => {
  if (
    event.request.method !== "GET"
    || event.request.url.includes("firestore.googleapis.com")
    || event.request.url.includes("fcmregistrations.googleapis.com")
  ) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (
          response.ok
          && new URL(event.request.url).origin === self.location.origin
        ) {
          const copy = response.clone();
          caches.open(VERSION).then(cache => cache.put(event.request, copy));
        }

        return response;
      })
      .catch(async () => {
        const cached = await caches.match(event.request);

        if (cached) return cached;
        if (event.request.mode === "navigate") {
          return (await caches.match("./index.html")) || (await caches.match("./welcome.html")) || Response.error();
        }

        return Response.error();
      })
  );
});
