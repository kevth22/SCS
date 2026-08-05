import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getMessaging, isSupported, onMessage } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js";

const firebaseConfig = {
  apiKey: "AIzaSyALS4oLAQZOVCeXANn77JxEzvyA7mfIER0",
  authDomain: "black-white-eagles.firebaseapp.com",
  projectId: "black-white-eagles",
  storageBucket: "black-white-eagles.firebasestorage.app",
  messagingSenderId: "85592070613",
  appId: "1:85592070613:web:da9965f7db7ef77fc7c55c"
};

const DEDUPE_PREFIX = "bweForegroundPush:";
const DEDUPE_MS = 15000;

function notificationData(payload) {
  return {
    title: payload?.notification?.title || payload?.data?.title || "Black White Eagles",
    body: payload?.notification?.body || payload?.data?.body || "Neue Mitteilung",
    icon: payload?.notification?.icon || payload?.data?.icon || "./icon-192.png",
    badge: payload?.notification?.badge || payload?.data?.badge || "./icon-192.png",
    tag: payload?.data?.tag || `bwe-${Date.now()}`,
    url: payload?.data?.url || "./index.html"
  };
}

function claimNotification(tag) {
  const key = `${DEDUPE_PREFIX}${tag}`;
  const now = Date.now();

  try {
    const previous = Number(localStorage.getItem(key) || 0);
    if (now - previous < DEDUPE_MS) return false;
    localStorage.setItem(key, String(now));

    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const storedKey = localStorage.key(index);
      if (!storedKey?.startsWith(DEDUPE_PREFIX)) continue;
      const storedAt = Number(localStorage.getItem(storedKey) || 0);
      if (now - storedAt > 60000) localStorage.removeItem(storedKey);
    }
  } catch {
    // Ohne LocalStorage bleibt die Benachrichtigung trotzdem funktionsfähig.
  }

  return true;
}

async function startForegroundPush() {
  if (!("serviceWorker" in navigator) || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  if (!(await isSupported())) return;

  const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  const messaging = getMessaging(app);

  onMessage(messaging, async payload => {
    const notification = notificationData(payload);
    if (!claimNotification(notification.tag)) return;

    try {
      const registration = await navigator.serviceWorker.ready;
      await registration.showNotification(notification.title, {
        body: notification.body,
        icon: notification.icon,
        badge: notification.badge,
        tag: notification.tag,
        data: { url: notification.url }
      });
    } catch (error) {
      console.warn("Vordergrund-Push konnte nicht angezeigt werden:", error);
    }
  });
}

startForegroundPush().catch(error => {
  console.warn("Vordergrund-Push konnte nicht gestartet werden:", error);
});
