import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGuest, retainTournamentGuests } from '../tournament-guests.js';

test('Gast erhält eigene ID und normalisierten Namen ohne Benutzerkonto', () => {
  assert.deepEqual(createGuest('  Max   Gast  ', [], '123'), { id: 'guest-123', name: 'Max Gast', rolle: 'gast', tournamentGuest: true });
});
test('Leere, zu lange und doppelte Namen werden abgelehnt', () => {
  for (const name of ['', ' ', 'A', 'x'.repeat(61)]) assert.throws(() => createGuest(name, [], '1'));
  assert.throws(() => createGuest(' MAX ', [{ name: 'Max' }], '2'), /bereits vorhanden/);
});
test('Kontensynchronisation erhält Gäste und deren historische IDs', () => {
  const guest = createGuest('Gast', [], '123');
  const members = retainTournamentGuests([{id:'member', name:'Neu'}], [guest, {id:'old',name:'Alt',rolle:'mitglied'}]);
  assert.deepEqual(members, [guest, {id:'member',name:'Neu'}]);
  assert.deepEqual(retainTournamentGuests(members, [guest]), members);
});
