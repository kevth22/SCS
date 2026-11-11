// Gastspieler sind Turnierteilnehmer, keine Benutzerkonten.
export function createGuest(name, members, id) {
  const cleanName = String(name || '').trim().replace(/\s+/g, ' ');
  if (cleanName.length < 2 || cleanName.length > 60) throw new Error('Bitte einen Gastnamen mit 2 bis 60 Zeichen eingeben.');
  if (members.some(member => member.name.trim().toLocaleLowerCase('de') === cleanName.toLocaleLowerCase('de'))) {
    throw new Error('Dieser Name ist bereits vorhanden. Bitte den Spieler auswählen oder einen eindeutigen Namen verwenden.');
  }
  return { id: `guest-${id}`, name: cleanName, rolle: 'gast', tournamentGuest: true };
}

export function retainTournamentGuests(accounts, previousMembers) {
  return [...accounts, ...previousMembers.filter(member => member.tournamentGuest === true && !accounts.some(account => account.id === member.id))]
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
}
