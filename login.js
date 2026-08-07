import {
  db,
  normalizeUsername,
  publicUserData,
  verifyPassword,
  migrateLegacyPassword,
  saveLogin,
  setNewPassword,
  getLogin,
  ensureInitialAdmin
} from "./auth-utils.js";

import {
  doc,
  getDoc,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";


// iPhones und installierte PWAs öffnen häufig die zuletzt besuchte Seite erneut.
// Ist bereits ein dauerhafter Login vorhanden, darf das Loginformular nicht
// erneut angezeigt werden.
const existingLogin = getLogin();
if (existingLogin && existingLogin.aktiv !== false) {
  sessionStorage.setItem("splashGesehen", "ja");
  window.location.replace("index.html");
}

let currentUser = null;
let loginAttempts = [];

const $ = id => document.getElementById(id);

function showMessage(element, message) {
  element.textContent = message;
  element.hidden = false;
}

function clearMessage(element) {
  element.textContent = "";
  element.hidden = true;
}

function tooManyAttempts() {
  const now = Date.now();
  loginAttempts = loginAttempts.filter(time => now - time < 10 * 60 * 1000);
  return loginAttempts.length >= 8;
}

async function login() {
  const errorBox = $("loginFehler");
  clearMessage(errorBox);

  if (tooManyAttempts()) {
    showMessage(errorBox, "Zu viele Versuche. Bitte warte zehn Minuten.");
    return;
  }

  const username = normalizeUsername($("loginUser").value);
  const password = $("loginPass").value;
  const remember = $("rememberLogin").checked;

  if (!username || !password) {
    showMessage(errorBox, "Bitte Benutzername und Passwort eingeben.");
    return;
  }

  const button = $("loginButton");
  button.disabled = true;
  button.textContent = "Wird geprüft …";

  try {
    await ensureInitialAdmin();
    const userRef = doc(db, "mitglieder", username);
    const snapshot = await getDoc(userRef);

    if (!snapshot.exists()) {
      loginAttempts.push(Date.now());
      throw new Error("LOGIN_FAILED");
    }

    const data = snapshot.data();

    if (data.aktiv !== true) {
      showMessage(errorBox, "Dieses Konto ist deaktiviert.");
      return;
    }

    const valid = await verifyPassword(password, data);

    if (!valid) {
      loginAttempts.push(Date.now());
      throw new Error("LOGIN_FAILED");
    }

    // Das festgelegte Systemkonto „Red Dart“ bleibt auch dann Admin,
    // wenn es in einer älteren App-Version bereits als Gast angelegt wurde.
    if (username === normalizeUsername("Red Dart") && String(data.rolle || "").toLowerCase() !== "admin") {
      await updateDoc(userRef, {
        rolle: "admin",
        adminAktiviertAm: serverTimestamp()
      });
      data.rolle = "admin";
    }

    await migrateLegacyPassword(userRef, password, data);

    currentUser = publicUserData(username, data);

    if (currentUser.mussPasswortAendern) {
      currentUser.rememberLogin = remember;
      $("loginBox").hidden = true;
      $("passwortBox").hidden = false;
      return;
    }

    saveLogin(currentUser, remember);
    sessionStorage.setItem("splashGesehen", "ja");
    window.location.replace("index.html");
  } catch (error) {
    console.error(error);
    showMessage(errorBox, "Benutzername oder Passwort ist falsch.");
  } finally {
    button.disabled = false;
    button.textContent = "Einloggen";
  }
}

async function changePassword() {
  const errorBox = $("passwortFehler");
  clearMessage(errorBox);

  const password1 = $("neuesPasswort").value;
  const password2 = $("neuesPasswort2").value;

  if (!currentUser) {
    showMessage(errorBox, "Bitte melde dich erneut an.");
    return;
  }

  if (password1.length < 8) {
    showMessage(errorBox, "Das Passwort muss mindestens 8 Zeichen haben.");
    return;
  }

  if (password1 !== password2) {
    showMessage(errorBox, "Die Passwörter stimmen nicht überein.");
    return;
  }

  try {
    await setNewPassword(currentUser.benutzername, password1, false);
    currentUser.mussPasswortAendern = false;
    saveLogin(currentUser, currentUser.rememberLogin === true);
    window.location.replace("index.html");
  } catch (error) {
    console.error(error);
    showMessage(errorBox, "Das Passwort konnte nicht gespeichert werden.");
  }
}

function continueAsGuest() {
  localStorage.removeItem("bweLogin");
  localStorage.removeItem("bweReminder");
  sessionStorage.removeItem("bweLogin");
  sessionStorage.removeItem("user");
  sessionStorage.removeItem("rolle");

  localStorage.setItem("bweGast", "true");
  sessionStorage.setItem("splashGesehen", "ja");
  window.location.replace("index.html");
}

$("loginButton").addEventListener("click", login);
$("passwordChangeButton").addEventListener("click", changePassword);
$("guestButton").addEventListener("click", continueAsGuest);

$("loginPass").addEventListener("keydown", event => {
  if (event.key === "Enter") login();
});
