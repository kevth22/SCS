import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore,
  collection,
  getDocs,
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getLogin } from "./auth-utils.js";

const firebaseConfig = {
  apiKey: "AIzaSyALS4oLAQZOVCeXANn77JxEzvyA7mfIER0",
  authDomain: "black-white-eagles.firebaseapp.com",
  projectId: "black-white-eagles",
  storageBucket: "black-white-eagles.firebasestorage.app",
  messagingSenderId: "85592070613",
  appId: "1:85592070613:web:da9965f7db7ef77fc7c55c"
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const db = getFirestore(app);

function closeVotePopup() {
  const popup = document.getElementById("votePopup");
  if (popup) popup.style.display = "none";
}

window.closeVotePopup = closeVotePopup;

async function checkVotePopup() {
  const popup = document.getElementById("votePopup");
  if (!popup) return;

  const user = getLogin();
  if (!user) return;

  const rolle = String(user.rolle || "").toLowerCase().trim();
  const benutzername = String(user.benutzername || "").trim();
  const erlaubteRollen = ["mitglied", "captain", "admin"];

  // Registrierte Gäste erhalten ausdrücklich keine Spieltagsbenachrichtigungen.
  if (!benutzername || !erlaubteRollen.includes(rolle)) return;

  try {
    const spieltageSnap = await getDocs(collection(db, "spieltage"));
    let spieltage = [];

    spieltageSnap.forEach(docSnap => {
      spieltage.push({ id: docSnap.id, ...docSnap.data() });
    });

    const heute = new Date();
    heute.setHours(0, 0, 0, 0);

    const in7Tagen = new Date(heute);
    in7Tagen.setDate(heute.getDate() + 7);
    in7Tagen.setHours(23, 59, 59, 999);

    spieltage = spieltage
      .filter(spieltag => {
        const datum = new Date(spieltag.datum);
        datum.setHours(0, 0, 0, 0);
        return datum >= heute && datum <= in7Tagen;
      })
      .sort((a, b) => new Date(a.datum) - new Date(b.datum));

    let offenerSpieltag = null;

    for (const spieltag of spieltage) {
      const zusageId = `${spieltag.id}_${benutzername}`;
      const zusageSnap = await getDoc(doc(db, "zusagen", zusageId));
      if (!zusageSnap.exists()) {
        offenerSpieltag = spieltag;
        break;
      }
    }

    if (!offenerSpieltag) return;

    const popupText = document.getElementById("votePopupText");
    const gegnerText = offenerSpieltag.typ === "heim"
      ? `Black White Eagles : ${offenerSpieltag.ort}`
      : `${offenerSpieltag.ort} : Black White Eagles`;

    popupText.innerHTML = `
      Du hast für diesen Spieltag noch keine Verfügbarkeit angegeben:<br><br>
      <strong>${offenerSpieltag.liga}</strong><br>
      ${gegnerText}<br>
      ${offenerSpieltag.datum}<br>
      Treffen: ${offenerSpieltag.treffen || "-"}<br>
      Anwurf: ${offenerSpieltag.anwurf}
    `;

    popup.style.display = "flex";
  } catch (error) {
    console.error("Spieltag-Popup konnte nicht geprüft werden:", error);
  }
}

document.addEventListener("DOMContentLoaded", checkVotePopup);

