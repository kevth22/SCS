import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyALS4oLAQZOVCeXANn77JxEzvyA7mfIER0",
  authDomain: "black-white-eagles.firebaseapp.com",
  projectId: "black-white-eagles",
  storageBucket: "black-white-eagles.firebasestorage.app",
  messagingSenderId: "85592070613",
  appId: "1:85592070613:web:da9965f7db7ef77fc7c55c"
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
export const db = getFirestore(app);

const HASH_ITERATIONS = 210000;
const SESSION_KEY = "bweLogin";
const SESSION_MARKER = "bweSitzungAktiv";

export function normalizeUsername(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9._-]/g, "");
}

export function publicUserData(username, data) {
  return {
    benutzername: username,
    vorname: data.vorname || "",
    nachname: data.nachname || "",
    nickname: data.nickname || username,
    rolle: String(data.rolle || "gast").toLowerCase(),
    aktiv: data.aktiv === true,
    mussPasswortAendern: data.mussPasswortAendern === true
  };
}

function bytesToBase64(bytes) {
  let binary = "";
  bytes.forEach(byte => binary += String.fromCharCode(byte));
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

export function createSalt() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return bytesToBase64(bytes);
}

export async function hashPassword(password, salt, iterations = HASH_ITERATIONS) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: base64ToBytes(salt),
      iterations,
      hash: "SHA-256"
    },
    material,
    256
  );

  return bytesToBase64(new Uint8Array(bits));
}

export async function verifyPassword(password, userData) {
  if (userData.passwortHash && userData.passwortSalt) {
    const calculated = await hashPassword(
      password,
      userData.passwortSalt,
      Number(userData.passwortIterationen) || HASH_ITERATIONS
    );
    return calculated === userData.passwortHash;
  }

  // Übergang für bestehende Nutzer mit Klartext-Passwort.
  return typeof userData.passwort === "string" && userData.passwort === password;
}

export async function migrateLegacyPassword(userRef, password, userData) {
  if (!userData.passwort || userData.passwortHash) return;

  const salt = createSalt();
  const hash = await hashPassword(password, salt);

  await updateDoc(userRef, {
    passwortHash: hash,
    passwortSalt: salt,
    passwortIterationen: HASH_ITERATIONS,
    passwort: null,
    passwortMigriertAm: serverTimestamp()
  });
}

export function saveLogin(user, remember) {
  const value = JSON.stringify(user);

  sessionStorage.setItem(SESSION_KEY, value);
  sessionStorage.setItem(SESSION_MARKER, "true");
  sessionStorage.setItem("user", value);
  sessionStorage.setItem("rolle", user.rolle || "gast");

  if (remember) {
    localStorage.setItem(SESSION_KEY, value);
    localStorage.setItem("bweAngemeldetBleiben", "true");
  } else {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem("bweAngemeldetBleiben");
  }

  localStorage.removeItem("bweGast");
}

export function getLogin() {
  const sessionValue = sessionStorage.getItem(SESSION_KEY);
  const localValue = localStorage.getItem(SESSION_KEY);
  const value = sessionValue || localValue;

  if (!value) return null;

  try {
    const user = JSON.parse(value);
    if (!sessionValue && localValue) {
      sessionStorage.setItem(SESSION_KEY, localValue);
      sessionStorage.setItem(SESSION_MARKER, "true");
      sessionStorage.setItem("user", localValue);
      sessionStorage.setItem("rolle", user.rolle || "gast");
    }
    return user;
  } catch {
    logout(false);
    return null;
  }
}

export function logout(redirect = true) {
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem("bweAngemeldetBleiben");
  localStorage.removeItem("bweReminder");
  localStorage.removeItem("bweGast");

  sessionStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(SESSION_MARKER);
  sessionStorage.removeItem("user");
  sessionStorage.removeItem("rolle");

  if (redirect) window.location.replace("login.html");
}

export async function registerAccount({ vorname, nachname, username, password }) {
  const normalized = normalizeUsername(username);
  const userRef = doc(db, "mitglieder", normalized);
  const salt = createSalt();
  const hash = await hashPassword(password, salt);

  await runTransaction(db, async transaction => {
    const existing = await transaction.get(userRef);
    if (existing.exists()) {
      throw new Error("USERNAME_EXISTS");
    }

    transaction.set(userRef, {
      vorname: vorname.trim(),
      nachname: nachname.trim(),
      nickname: username.trim(),
      benutzername: normalized,
      rolle: "gast",
      aktiv: true,
      mussPasswortAendern: false,
      passwortHash: hash,
      passwortSalt: salt,
      passwortIterationen: HASH_ITERATIONS,
      datenschutzAkzeptiert: true,
      datenschutzVersion: "2026-07",
      erstelltAm: serverTimestamp()
    });
  });

  return normalized;
}

export async function setNewPassword(username, password, forceChange = false) {
  const normalized = normalizeUsername(username);
  const userRef = doc(db, "mitglieder", normalized);
  const snapshot = await getDoc(userRef);

  if (!snapshot.exists()) throw new Error("USER_NOT_FOUND");

  const salt = createSalt();
  const hash = await hashPassword(password, salt);

  await updateDoc(userRef, {
    passwortHash: hash,
    passwortSalt: salt,
    passwortIterationen: HASH_ITERATIONS,
    passwort: null,
    mussPasswortAendern: forceChange,
    passwortGeaendertAm: serverTimestamp()
  });
}

export async function ensureInitialAdmin() {
  const username = normalizeUsername("Red Dart");
  const userRef = doc(db, "mitglieder", username);
  const snapshot = await getDoc(userRef);
  if (snapshot.exists()) return false;

  const salt = createSalt();
  const hash = await hashPassword("1234", salt);

  // Zweistufig anlegen: Die Übergangsregeln erlauben neue Konten zunächst
  // nur mit der Rolle „gast“. Updates sind erlaubt, daher wird das einmalige
  // Systemkonto direkt danach zum Admin hochgestuft.
  await setDoc(userRef, {
    vorname: "Kevin",
    nachname: "Roth",
    nickname: "Red Dart",
    benutzername: username,
    rolle: "gast",
    aktiv: true,
    mussPasswortAendern: true,
    passwortHash: hash,
    passwortSalt: salt,
    passwortIterationen: HASH_ITERATIONS,
    erstelltAm: serverTimestamp(),
    systemkonto: true
  });

  await updateDoc(userRef, {
    rolle: "admin",
    adminAktiviertAm: serverTimestamp()
  });
  return true;
}
