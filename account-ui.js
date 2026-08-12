import { getLogin, logout } from "./auth-utils.js";

function renderAccountControls() {
  const user = getLogin();
  const host = document.getElementById("accountControls");

  if (!host) return;

  if (!user) {
    host.innerHTML = `
      <a class="account-login-button" href="login.html">
        🔐 Anmelden
      </a>
    `;
    return;
  }

  const role = String(user.rolle || "gast").toLowerCase();

  const kasseCard = document.getElementById("kasseCard");
  if (kasseCard) {
    kasseCard.hidden = !["admin", "captain", "kassenwart"].includes(role);
  }

  const adminLink = role === "admin"
    ? `
      <a href="konto-admin.html">
        ⚙️ Konten verwalten
      </a>
    `
    : "";

  host.innerHTML = `
    <div class="account-summary">
      <strong>${escapeHtml(user.nickname || user.benutzername)}</strong>
      <span>${escapeHtml(role)}</span>
    </div>

    <a href="profil.html">
      👤 Mein Profil
    </a>

    ${adminLink}

    <button id="logoutButton" class="secondary-button" type="button">
      🚪 Abmelden
    </button>
  `;

  document.getElementById("logoutButton")?.addEventListener("click", () => {
    logout(true);
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

document.addEventListener("DOMContentLoaded", renderAccountControls);
