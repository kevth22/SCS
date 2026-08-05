import {
  normalizeUsername,
  registerAccount
} from "./auth-utils.js";

const $ = id => document.getElementById(id);
const RATE_LIMIT_KEY = "bweLetzteRegistrierung";

function showMessage(message, success = false) {
  const box = $("registerMessage");
  box.textContent = message;
  box.className = `konto-meldung ${success ? "erfolg" : "fehler"}`;
  box.hidden = false;
}

function validName(value) {
  return /^[A-Za-zÄÖÜäöüßÀ-ÿ' -]{2,50}$/.test(value.trim());
}

async function register() {
  const firstName = $("firstName").value.trim();
  const lastName = $("lastName").value.trim();
  const rawUsername = $("username").value.trim();
  const username = normalizeUsername(rawUsername);
  const password = $("password").value;
  const repeated = $("passwordRepeat").value;

  if ($("website").value) return;

  const lastRegistration = Number(localStorage.getItem(RATE_LIMIT_KEY) || 0);
  if (Date.now() - lastRegistration < 5 * 60 * 1000) {
    showMessage("Bitte warte einige Minuten, bevor du erneut ein Konto erstellst.");
    return;
  }

  if (!validName(firstName) || !validName(lastName)) {
    showMessage("Bitte gib einen gültigen Vor- und Nachnamen ein.");
    return;
  }

  if (username.length < 3 || username.length > 30) {
    showMessage("Der Benutzername muss zwischen 3 und 30 Zeichen lang sein.");
    return;
  }

  if (username !== rawUsername.toLowerCase().replace(/\s+/g, "")) {
    showMessage("Im Benutzernamen sind nur Buchstaben, Zahlen, Punkt, Unterstrich und Bindestrich erlaubt.");
    return;
  }

  if (password.length < 8) {
    showMessage("Das Passwort muss mindestens 8 Zeichen haben.");
    return;
  }

  if (password !== repeated) {
    showMessage("Die Passwörter stimmen nicht überein.");
    return;
  }

  if (!$("privacyAccepted").checked) {
    showMessage("Du musst der Datenschutzerklärung zustimmen.");
    return;
  }

  const button = $("registerButton");
  button.disabled = true;
  button.textContent = "Konto wird erstellt …";

  try {
    await registerAccount({
      vorname: firstName,
      nachname: lastName,
      username: rawUsername,
      password
    });

    localStorage.setItem(RATE_LIMIT_KEY, String(Date.now()));
    showMessage("Dein Gastkonto wurde erstellt. Du kannst dich jetzt einloggen.", true);

    setTimeout(() => {
      window.location.replace(`login.html?user=${encodeURIComponent(username)}`);
    }, 1300);
  } catch (error) {
    console.error(error);
    if (error.message === "USERNAME_EXISTS") {
      showMessage("Dieser Nickname ist bereits vergeben.");
    } else {
      showMessage("Das Konto konnte nicht erstellt werden. Prüfe deine Verbindung oder die Firestore-Regeln.");
    }
  } finally {
    button.disabled = false;
    button.textContent = "Gastkonto erstellen";
  }
}

$("registerButton").addEventListener("click", register);
