import { db, getLogin, saveLogin, publicUserData } from './auth-utils.js';
import { doc, getDoc, updateDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const user = getLogin();
if (!user?.benutzername) window.location.replace('login.html');

const ref = doc(db, 'mitglieder', user.benutzername);
const preview = document.getElementById('profilePreview');
const imageInput = document.getElementById('profileImageInput');
const message = document.getElementById('profileMessage');
const cropModal = document.getElementById('cropModal');
const cropStage = document.getElementById('cropStage');
const cropCanvas = document.getElementById('cropCanvas');
const cropCtx = cropCanvas.getContext('2d');
const cropZoom = document.getElementById('cropZoom');

let imageData = '';
let removeImage = false;
let cropImage = null;
let cropBaseScale = 1;
let cropScale = 1;
let cropX = 0;
let cropY = 0;
let dragging = false;
let dragStartX = 0;
let dragStartY = 0;
let startCropX = 0;
let startCropY = 0;

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

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
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
}

function clampCropPosition() {
  if (!cropImage) return;
  const w = cropImage.naturalWidth * cropScale;
  const h = cropImage.naturalHeight * cropScale;
  const minX = cropCanvas.width - w;
  const minY = cropCanvas.height - h;
  cropX = Math.min(0, Math.max(minX, cropX));
  cropY = Math.min(0, Math.max(minY, cropY));
}

function drawCrop() {
  cropCtx.clearRect(0, 0, cropCanvas.width, cropCanvas.height);
  if (!cropImage) return;
  clampCropPosition();
  cropCtx.drawImage(
    cropImage,
    cropX,
    cropY,
    cropImage.naturalWidth * cropScale,
    cropImage.naturalHeight * cropScale
  );
}

function openCropEditor(img) {
  cropImage = img;
  cropBaseScale = Math.max(
    cropCanvas.width / img.naturalWidth,
    cropCanvas.height / img.naturalHeight
  );
  cropScale = cropBaseScale;
  cropZoom.value = '1';
  cropX = (cropCanvas.width - img.naturalWidth * cropScale) / 2;
  cropY = (cropCanvas.height - img.naturalHeight * cropScale) / 2;
  cropModal.hidden = false;
  document.body.classList.add('crop-open');
  drawCrop();
}

function closeCropEditor({ clearInput = true } = {}) {
  cropModal.hidden = true;
  document.body.classList.remove('crop-open');
  cropImage = null;
  dragging = false;
  if (clearInput) imageInput.value = '';
}

function pointerPosition(event) {
  const rect = cropStage.getBoundingClientRect();
  const scaleX = cropCanvas.width / rect.width;
  const scaleY = cropCanvas.height / rect.height;
  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY
  };
}

cropStage.addEventListener('pointerdown', event => {
  if (!cropImage) return;
  dragging = true;
  cropStage.setPointerCapture?.(event.pointerId);
  const pos = pointerPosition(event);
  dragStartX = pos.x;
  dragStartY = pos.y;
  startCropX = cropX;
  startCropY = cropY;
  cropStage.classList.add('dragging');
});

cropStage.addEventListener('pointermove', event => {
  if (!dragging || !cropImage) return;
  event.preventDefault();
  const pos = pointerPosition(event);
  cropX = startCropX + (pos.x - dragStartX);
  cropY = startCropY + (pos.y - dragStartY);
  drawCrop();
});

function stopDragging(event) {
  if (!dragging) return;
  dragging = false;
  cropStage.releasePointerCapture?.(event.pointerId);
  cropStage.classList.remove('dragging');
}

cropStage.addEventListener('pointerup', stopDragging);
cropStage.addEventListener('pointercancel', stopDragging);

cropZoom.addEventListener('input', () => {
  if (!cropImage) return;
  const oldScale = cropScale;
  const centerX = cropCanvas.width / 2;
  const centerY = cropCanvas.height / 2;
  const imageCenterX = (centerX - cropX) / oldScale;
  const imageCenterY = (centerY - cropY) / oldScale;
  cropScale = cropBaseScale * Number(cropZoom.value || 1);
  cropX = centerX - imageCenterX * cropScale;
  cropY = centerY - imageCenterY * cropScale;
  drawCrop();
});

function createCroppedImage() {
  const output = document.createElement('canvas');
  output.width = 320;
  output.height = 320;
  const ctx = output.getContext('2d');
  ctx.drawImage(cropCanvas, 0, 0, 320, 320);
  return output.toDataURL('image/jpeg', 0.82);
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
  if (!file.type.startsWith('image/')) {
    imageInput.value = '';
    return showMessage('Bitte eine Bilddatei auswählen.', 'error');
  }
  if (file.size > 8 * 1024 * 1024) {
    imageInput.value = '';
    return showMessage('Das Bild ist zu groß. Maximal 8 MB.', 'error');
  }
  try {
    const img = await loadImageFromFile(file);
    openCropEditor(img);
  } catch (error) {
    console.error(error);
    imageInput.value = '';
    showMessage('Das Bild konnte nicht verarbeitet werden.', 'error');
  }
});

document.getElementById('applyCrop').addEventListener('click', () => {
  if (!cropImage) return;
  imageData = createCroppedImage();
  removeImage = false;
  renderPreview(imageData, data.nickname || user.benutzername);
  closeCropEditor();
  showMessage('Ausschnitt übernommen. Jetzt Profil speichern.');
});

document.getElementById('cancelCrop').addEventListener('click', () => closeCropEditor());
document.getElementById('closeCrop').addEventListener('click', () => closeCropEditor());
cropModal.addEventListener('click', event => {
  if (event.target === cropModal) closeCropEditor();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !cropModal.hidden) closeCropEditor();
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
