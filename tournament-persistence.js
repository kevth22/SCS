// Firestore wird injiziert, damit derselbe Transaktionsablauf automatisiert
// mit konkurrierenden Schreibvorgängen geprüft werden kann.
export function canonical(value) {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (typeof value.toJSON === 'function') return canonical(value.toJSON());
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
}
export function createTournamentWriter({ db, ref, getState, setState, getActor, roles,
  runTransaction, getDoc, memberRef, serverTimestamp, render, notify }) {
  let baseline = null, lastConfirmed = null, saving = false;
  const emptyState = () => ({ members: [], seasons: [], activeSeasonId: null, current: null });
  return {
    loaded(data) { baseline = canonical(data || null); lastConfirmed = data ? structuredClone(data) : null; },
    async save({ render: shouldRender = true } = {}) {
      if (saving) throw new Error('Ein Speichervorgang läuft bereits. Bitte warten.');
      const actor = getActor();
      if (!actor) throw new Error('Administratorzugang erforderlich.');
      saving = true;
      const { updatedAt: _oldTimestamp, ...data } = getState();
      const payload = structuredClone(data);
      // Das bestehende Ein-Dokument-Modell hat eine feste Firestore-Größengrenze.
      try {
        if (new TextEncoder().encode(JSON.stringify(payload)).length > 900000) throw new Error('Der Turnierspeicher nähert sich der Firestore-Grenze. Nicht gespeichert; Historie muss kontrolliert archiviert werden.');
        await runTransaction(db, async transaction => {
          const [remote, member] = await Promise.all([transaction.get(ref), transaction.get(memberRef(actor))]);
          const account = member.exists() ? member.data() : null;
          if (!account || account.aktiv === false || !roles.includes(String(account.rolle).toLowerCase())) throw new Error('Keine aktive Verwaltungsberechtigung.');
          const remoteData = remote.exists() ? remote.data() : null;
          // Vollständiger Quellstand zusätzlich zur Revision: erkennt auch ältere
          // App-Versionen, die noch keine Revision mitspeichern.
          if (canonical(remoteData) !== baseline) throw new Error('Ein anderer Administrator hat Daten geändert. Der aktuelle Stand wird neu geladen. Bitte Änderung erneut prüfen.');
          payload.revision = (remoteData?.revision || 0) + 1;
          transaction.set(ref, { ...payload, updatedAt: serverTimestamp() });
        });
        // Ausschließlich den bestätigten Serverstand als nächste Basis verwenden.
        const fresh = await getDoc(ref);
        baseline = canonical(fresh.exists() ? fresh.data() : null);
        lastConfirmed = fresh.exists() ? structuredClone(fresh.data()) : null;
        setState(fresh.exists() ? fresh.data() : emptyState());
        if (shouldRender) render();
      } catch (error) {
        // Keine lokalen, ungespeicherten Ergebnisse als vermeintlichen Erfolg anzeigen.
        try {
          const fresh = await getDoc(ref);
          baseline = canonical(fresh.exists() ? fresh.data() : null);
          lastConfirmed = fresh.exists() ? structuredClone(fresh.data()) : null;
          setState(fresh.exists() ? fresh.data() : emptyState());
          render();
        } catch {
          setState(lastConfirmed ? structuredClone(lastConfirmed) : emptyState());
          render();
        }
        notify(error.message);
        throw error;
      } finally { saving = false; }
    }
  };
}
