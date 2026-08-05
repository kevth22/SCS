(() => {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
      try {
        await navigator.serviceWorker.register('./sw.js?v=11.1', { updateViaCache: 'none' });
      } catch (error) {
        console.warn('Offline-Modus konnte nicht gestartet werden.', error);
      }
    });
  }

  let installPrompt = null;
  const istStartseite = /(?:^|\/)index\.html$/.test(location.pathname) || location.pathname.endsWith('/');
  const button = istStartseite ? document.getElementById('pwaInstallButton') : null;

  button?.addEventListener('click', async () => {
    if (installPrompt) {
      installPrompt.prompt();
      await installPrompt.userChoice;
      installPrompt = null;
      return;
    }
    const istIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    alert(istIOS
      ? 'Tippe unten auf „Teilen“ und anschließend auf „Zum Home-Bildschirm“.'
      : 'Öffne das Browsermenü und wähle „App installieren“ oder „Zum Startbildschirm hinzufügen“.');
  });

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installPrompt = event;
  });

  window.addEventListener('appinstalled', () => {
    button?.remove();
    installPrompt = null;
  });
})();
