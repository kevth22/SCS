import { db, getLogin, saveLogin, publicUserData } from './auth-utils.js';
import { doc, getDoc, updateDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const user = getLogin();
if (!user?.benutzername) window.location.replace('login.html');

const ref = doc(db, 'mitglieder', user.benutzername);
const preview = document.getElementById('profilePreview');
const imageInput = document.getElementById('profileImageInput');
const message = document.getElementById('profileMessage');
let imageData = '';
let removeImage = false;

function showMessage(text, type = 'success') {
  message.textContent = text;
  message.className = `profile-message ${type}`;
}

function initials(name) {
  return String(name || '?').trim().split(/\s+/).map(p => p[0]).join('').slice(0,2).toUpperCase();
}

function renderPreview(src, name) {
  preview.innerHTML = src ? `<img src="${src}" alt="Profilbild">` : initials(name);
}

async function resizeImage(file) {
  const source = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => resolve(img);
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
  const max = 320;
  const scale = Math.min(1, max / Math.max(source.naturalWidth, source.naturalHeight));
  const width = Math.max(1, Math.round(source.naturalWidth * scale));
  const height = Math.max(1, Math.round(source.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  canvas.getContext('2d').drawImage(source, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', .78);
}

const snap = await getDoc(ref);
if (!snap.exists()) window.location.replace('login.html');
const data = snap.data();
document.getElementById('profileNickname').textContent = data.nickname || data.benutzername || user.benutzername;
document.getElementById('scoliaName').value = data.scoliaName || '';
document.getElementById('birthday').value = data.geburtstag || '';
imageData = data.profilbild || '';
renderPreview(imageData, data.nickname || user.benutzername);

imageInput.addEventListener('change', async () => {
  const file = imageInput.files?.[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) return showMessage('Bitte eine Bilddatei auswählen.', 'error');
  if (file.size > 8 * 1024 * 1024) return showMessage('Das Bild ist zu groß. Maximal 8 MB.', 'error');
  try {
    imageData = await resizeImage(file);
    removeImage = false;
    renderPreview(imageData, data.nickname || user.benutzername);
    showMessage('Bild vorbereitet. Jetzt Profil speichern.');
  } catch (error) {
    console.error(error);
    showMessage('Das Bild konnte nicht verarbeitet werden.', 'error');
  }
});

document.getElementById('removeProfileImage').addEventListener('click', () => {
  imageData = '';
  removeImage = true;
  renderPreview('', data.nickname || user.benutzername);
  showMessage('Bild wird beim Speichern entfernt.');
});

document.getElementById('saveProfile').addEventListener('click', async () => {
  const scoliaName = document.getElementById('scoliaName').value.trim();
  const geburtstag = document.getElementById('birthday').value;
  try {
    await updateDoc(ref, {
      scoliaName,
      geburtstag,
      profilbild: removeImage ? '' : imageData,
      profilGeaendertAm: serverTimestamp()
    });
    const fresh = await getDoc(ref);
    const newData = fresh.data();
    const wasRemembered = localStorage.getItem('bweAngemeldetBleiben') === 'true';
    saveLogin(publicUserData(user.benutzername, newData), wasRemembered);
    showMessage('Profil gespeichert.');
  } catch (error) {
    console.error(error);
    showMessage('Profil konnte nicht gespeichert werden.', 'error');
  }
});
