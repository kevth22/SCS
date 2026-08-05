import {
  db,
  getLogin,
  normalizeUsername,
  setNewPassword
} from "./auth-utils.js";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  runTransaction,
  writeBatch,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const $ = id => document.getElementById(id);
const currentAdmin = getLogin();
let allUsers = [];

const ALLOWED_ROLES = ["admin", "captain", "kassenwart", "mitglied", "gast"];

if (!currentAdmin || String(currentAdmin.rolle).toLowerCase() !== "admin") {
  $("accessDenied").hidden = false;
} else {
  $("adminContent").hidden = false;
  loadUsers();
}

function showBox(id, message, success = false) {
  const box = $(id);
  box.textContent = message;
  box.className = `konto-meldung ${success ? "erfolg" : "fehler"}`;
  box.hidden = false;
}

function hideBox(id) {
  const box = $(id);
  box.hidden = true;
  box.textContent = "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatTimestamp(value) {
  if (!value) return "Nicht gespeichert";

  try {
    const date = typeof value.toDate === "function"
      ? value.toDate()
      : new Date(value);

    if (Number.isNaN(date.getTime())) return "Nicht gespeichert";

    return new Intl.DateTimeFormat("de-DE", {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(date);
  } catch {
    return "Nicht gespeichert";
  }
}

function getPasswordStatus(user) {
  if (user.passwortHash && user.passwortSalt) return "🔒 Hash gespeichert";
  if (typeof user.passwort === "string" && user.passwort) return "⚠️ Altes Passwortformat";
  return "❌ Kein Passwort gespeichert";
}

async function loadUsers() {
  const list = $("usersList");
  const refreshButton = $("refreshUsersButton");

  hideBox("usersMessage");
  refreshButton.disabled = true;
  refreshButton.textContent = "Wird geladen …";
  list.innerHTML = '<p class="konto-hinweis">Benutzer werden geladen …</p>';

  try {
    const snapshot = await getDocs(collection(db, "mitglieder"));

    allUsers = snapshot.docs
      .map(documentSnapshot => ({
        id: documentSnapshot.id,
        ...documentSnapshot.data()
      }))
      .sort((a, b) => {
        const nameA = `${a.nachname || ""} ${a.vorname || ""} ${a.id}`.toLowerCase();
        const nameB = `${b.nachname || ""} ${b.vorname || ""} ${b.id}`.toLowerCase();
        return nameA.localeCompare(nameB, "de");
      });

    renderUsers();
  } catch (error) {
    console.error(error);
    list.innerHTML = "";
    showBox("usersMessage", "Die Benutzer konnten nicht geladen werden. Prüfe die Firestore-Regeln.");
  } finally {
    refreshButton.disabled = false;
    refreshButton.textContent = "↻ Aktualisieren";
  }
}

function renderUsers() {
  const search = $("userSearch").value.trim().toLowerCase();
  const roleFilter = $("roleFilter").value;

  const filtered = allUsers.filter(user => {
    const role = String(user.rolle || "gast").toLowerCase();
    const searchable = [
      user.id,
      user.benutzername,
      user.nickname,
      user.vorname,
      user.nachname
    ].join(" ").toLowerCase();

    return (!search || searchable.includes(search))
      && (!roleFilter || role === roleFilter);
  });

  $("totalUsers").textContent = `${allUsers.length} Konten`;
  $("activeUsers").textContent = `${allUsers.filter(user => user.aktiv === true).length} aktiv`;
  $("guestUsers").textContent = `${allUsers.filter(user => String(user.rolle || "gast").toLowerCase() === "gast").length} Gäste`;

  if (!filtered.length) {
    $("usersList").innerHTML = '<p class="konto-hinweis">Keine passenden Konten gefunden.</p>';
    return;
  }

  $("usersList").innerHTML = filtered.map(user => {
    const username = user.benutzername || user.id;
    const role = String(user.rolle || "gast").toLowerCase();
    const isSelf = username === currentAdmin.benutzername;
    const fullName = `${user.vorname || ""} ${user.nachname || ""}`.trim() || "Kein Name gespeichert";
    const nickname = user.nickname && user.nickname !== username
      ? `<span class="user-nickname">${escapeHtml(user.nickname)}</span>`
      : "";

    const roleOptions = ALLOWED_ROLES.map(option => `
      <option value="${option}" ${role === option ? "selected" : ""}>
        ${roleLabel(option)}
      </option>
    `).join("");

    return `
      <article class="user-admin-card" data-user="${escapeHtml(username)}">
        <div class="user-card-heading">
          <div>
            <h3>${escapeHtml(fullName)}</h3>
            <p><strong>@${escapeHtml(username)}</strong> ${nickname}</p>
          </div>
          <span class="status-pill ${user.aktiv === true ? "active" : "inactive"}">
            ${user.aktiv === true ? "Aktiv" : "Deaktiviert"}
          </span>
        </div>

        <div class="user-data-grid">
          <div>
            <small>Rolle</small>
            <strong>${escapeHtml(roleLabel(role))}</strong>
          </div>
          <div>
            <small>Passwort</small>
            <strong>${escapeHtml(getPasswordStatus(user))}</strong>
          </div>
          <div>
            <small>Passwortänderung nötig</small>
            <strong>${user.mussPasswortAendern === true ? "Ja" : "Nein"}</strong>
          </div>
          <div>
            <small>Erstellt</small>
            <strong>${escapeHtml(formatTimestamp(user.erstelltAm))}</strong>
          </div>
        </div>

        <div class="user-admin-actions">
          <label>
            Rolle
            <select class="role-select" data-username="${escapeHtml(username)}" ${isSelf ? "disabled" : ""}>
              ${roleOptions}
            </select>
          </label>

          <button
            type="button"
            class="toggle-active-button secondary-button"
            data-username="${escapeHtml(username)}"
            data-active="${user.aktiv === true}"
            ${isSelf ? "disabled" : ""}
          >
            ${user.aktiv === true ? "Konto deaktivieren" : "Konto aktivieren"}
          </button>

          <button
            type="button"
            class="prepare-username-button secondary-button"
            data-username="${escapeHtml(username)}"
            ${isSelf ? "disabled" : ""}
          >
            Benutzername ändern
          </button>

          <button
            type="button"
            class="prepare-reset-button"
            data-username="${escapeHtml(username)}"
          >
            Passwort zurücksetzen
          </button>
        </div>

        ${isSelf ? '<p class="self-protection">Dein eigenes Admin-Konto ist vor Rollenwechsel und Deaktivierung geschützt.</p>' : ""}
      </article>
    `;
  }).join("");

  bindUserActions();
}

function roleLabel(role) {
  const labels = {
    admin: "Admin",
    captain: "Captain",
    kassenwart: "Kassenwart",
    mitglied: "Mitglied",
    gast: "Gast"
  };

  return labels[role] || role;
}

function bindUserActions() {
  document.querySelectorAll(".role-select").forEach(select => {
    select.addEventListener("change", async event => {
      const username = event.currentTarget.dataset.username;
      const newRole = event.currentTarget.value;
      await changeRole(username, newRole, event.currentTarget);
    });
  });

  document.querySelectorAll(".toggle-active-button").forEach(button => {
    button.addEventListener("click", async event => {
      const username = event.currentTarget.dataset.username;
      const currentlyActive = event.currentTarget.dataset.active === "true";
      await changeActiveStatus(username, !currentlyActive, event.currentTarget);
    });
  });

  document.querySelectorAll(".prepare-username-button").forEach(button => {
    button.addEventListener("click", event => {
      const username = event.currentTarget.dataset.username;
      $("oldUsername").value = username;
      $("newUsername").value = username;
      hideBox("usernameMessage");
      $("usernameChangeSection").scrollIntoView({ behavior: "smooth", block: "start" });
      $("newUsername").focus();
      $("newUsername").select();
    });
  });

  document.querySelectorAll(".prepare-reset-button").forEach(button => {
    button.addEventListener("click", event => {
      const username = event.currentTarget.dataset.username;
      $("adminUsername").value = username;
      $("passwordResetSection").scrollIntoView({ behavior: "smooth", block: "start" });
      $("temporaryPassword").focus();
    });
  });
}

async function changeRole(username, newRole, control) {
  if (!ALLOWED_ROLES.includes(newRole)) return;
  if (username === currentAdmin.benutzername) return;

  control.disabled = true;

  try {
    await updateDoc(doc(db, "mitglieder", username), {
      rolle: newRole,
      rolleGeaendertAm: serverTimestamp(),
      rolleGeaendertVon: currentAdmin.benutzername
    });

    const localUser = allUsers.find(user => (user.benutzername || user.id) === username);
    if (localUser) localUser.rolle = newRole;

    showBox("usersMessage", `Die Rolle von „${username}“ wurde auf ${roleLabel(newRole)} geändert.`, true);
    renderUsers();
  } catch (error) {
    console.error(error);
    showBox("usersMessage", "Die Rolle konnte nicht geändert werden.");
    renderUsers();
  }
}

async function changeActiveStatus(username, newStatus, button) {
  if (username === currentAdmin.benutzername) return;

  button.disabled = true;

  try {
    await updateDoc(doc(db, "mitglieder", username), {
      aktiv: newStatus,
      aktivGeaendertAm: serverTimestamp(),
      aktivGeaendertVon: currentAdmin.benutzername
    });

    const localUser = allUsers.find(user => (user.benutzername || user.id) === username);
    if (localUser) localUser.aktiv = newStatus;

    showBox(
      "usersMessage",
      `Das Konto „${username}“ wurde ${newStatus ? "aktiviert" : "deaktiviert"}.`,
      true
    );
    renderUsers();
  } catch (error) {
    console.error(error);
    showBox("usersMessage", "Der Kontostatus konnte nicht geändert werden.");
    renderUsers();
  }
}

async function changeUsername() {
  const oldUsername = normalizeUsername($("oldUsername").value);
  const newUsername = normalizeUsername($("newUsername").value);
  hideBox("usernameMessage");

  if (!oldUsername || !newUsername) {
    showBox("usernameMessage", "Bitte alten und neuen Benutzernamen eingeben.");
    return;
  }

  if (newUsername.length < 3 || newUsername.length > 30) {
    showBox("usernameMessage", "Der neue Benutzername muss zwischen 3 und 30 Zeichen lang sein.");
    return;
  }

  if (newUsername === oldUsername) {
    showBox("usernameMessage", "Der neue Benutzername ist identisch mit dem bisherigen.");
    return;
  }

  if (oldUsername === currentAdmin.benutzername) {
    showBox("usernameMessage", "Dein eigenes Admin-Konto kann hier nicht umbenannt werden.");
    return;
  }

  const button = $("changeUsernameButton");
  button.disabled = true;
  button.textContent = "Benutzername wird geändert …";

  try {
    const oldRef = doc(db, "mitglieder", oldUsername);
    const newRef = doc(db, "mitglieder", newUsername);

    await runTransaction(db, async transaction => {
      const [oldSnapshot, newSnapshot] = await Promise.all([
        transaction.get(oldRef),
        transaction.get(newRef)
      ]);

      if (!oldSnapshot.exists()) throw new Error("USER_NOT_FOUND");
      if (newSnapshot.exists()) throw new Error("USERNAME_EXISTS");

      const oldData = oldSnapshot.data();
      transaction.set(newRef, {
        ...oldData,
        benutzername: newUsername,
        // Diese feste ID hält Mitgliedsbeiträge trotz Umbenennung zusammen.
        mitgliedId: oldData.mitgliedId || oldUsername,
        benutzernameVorher: oldUsername,
        benutzernameGeaendertAm: serverTimestamp(),
        benutzernameGeaendertVon: currentAdmin.benutzername
      });
      transaction.delete(oldRef);
    });

    // Bestehende Zusagen verwenden den Benutzernamen auch in der Dokument-ID.
    const responses = await getDocs(query(collection(db, "zusagen"), where("benutzername", "==", oldUsername)));
    for (const responseDoc of responses.docs) {
      const data = responseDoc.data();
      const newId = data.spieltagId ? `${data.spieltagId}_${newUsername}` : responseDoc.id.replace(oldUsername, newUsername);
      const batch = writeBatch(db);
      batch.set(doc(db, "zusagen", newId), {
        ...data,
        benutzername: newUsername,
        benutzernameGeaendertAm: serverTimestamp()
      });
      batch.delete(responseDoc.ref);
      await batch.commit();
    }

    // Push-Abos und weitere Datensätze behalten ihre ID, bekommen aber den neuen Namen.
    for (const collectionName of ["pushAbos", "warteschlange", "kassenProfile", "kassenBeitraege"]) {
      try {
        const matches = await getDocs(query(collection(db, collectionName), where("benutzername", "==", oldUsername)));
        if (!matches.empty) {
          const batch = writeBatch(db);
          matches.docs.forEach(match => batch.update(match.ref, {
            benutzername: newUsername,
            benutzernameGeaendertAm: serverTimestamp()
          }));
          await batch.commit();
        }
      } catch (migrationError) {
        console.warn(`Verknüpfte Daten in ${collectionName} konnten nicht vollständig angepasst werden.`, migrationError);
      }
    }

    $("oldUsername").value = newUsername;
    $("newUsername").value = "";
    showBox("usernameMessage", `Der Benutzername wurde von „${oldUsername}“ zu „${newUsername}“ geändert. Der Nutzer muss sich künftig mit dem neuen Benutzernamen anmelden.`, true);
    await loadUsers();
  } catch (error) {
    console.error(error);
    if (error.message === "USERNAME_EXISTS") {
      showBox("usernameMessage", "Dieser Benutzername ist bereits vergeben.");
    } else if (error.message === "USER_NOT_FOUND") {
      showBox("usernameMessage", "Das ausgewählte Konto wurde nicht gefunden.");
    } else {
      showBox("usernameMessage", "Der Benutzername konnte nicht geändert werden. Prüfe die Firestore-Regeln.");
    }
  } finally {
    button.disabled = false;
    button.textContent = "Benutzername ändern";
  }
}

async function resetPassword() {
  const username = normalizeUsername($("adminUsername").value);
  const password = $("temporaryPassword").value;
  const repeated = $("temporaryPasswordRepeat").value;

  hideBox("adminMessage");

  if (!username) {
    showBox("adminMessage", "Bitte einen Benutzernamen eingeben.");
    return;
  }

  if (password.length < 8) {
    showBox("adminMessage", "Das Startpasswort muss mindestens 8 Zeichen haben.");
    return;
  }

  if (password !== repeated) {
    showBox("adminMessage", "Die Passwörter stimmen nicht überein.");
    return;
  }

  const button = $("resetButton");
  button.disabled = true;
  button.textContent = "Wird zurückgesetzt …";

  try {
    await setNewPassword(username, password, true);
    showBox("adminMessage", `Das Passwort für „${username}“ wurde zurückgesetzt.`, true);
    $("temporaryPassword").value = "";
    $("temporaryPasswordRepeat").value = "";

    const localUser = allUsers.find(user => (user.benutzername || user.id) === username);
    if (localUser) {
      localUser.mussPasswortAendern = true;
      localUser.passwortHash = "vorhanden";
      localUser.passwortSalt = "vorhanden";
      localUser.passwort = null;
    }
    renderUsers();
  } catch (error) {
    console.error(error);
    if (error.message === "USER_NOT_FOUND") {
      showBox("adminMessage", "Dieser Benutzer wurde nicht gefunden.");
    } else {
      showBox("adminMessage", "Das Passwort konnte nicht zurückgesetzt werden.");
    }
  } finally {
    button.disabled = false;
    button.textContent = "Passwort zurücksetzen";
  }
}

$("changeUsernameButton").addEventListener("click", changeUsername);
$("resetButton").addEventListener("click", resetPassword);
$("refreshUsersButton").addEventListener("click", loadUsers);
$("userSearch").addEventListener("input", renderUsers);
$("roleFilter").addEventListener("change", renderUsers);
