import { matchUnit } from './prospects.mjs';

const stakeRoles = new Map([
  ['Stake President', 'presidency'],
  ['Stake Presidency First Counselor', 'presidency'],
  ['Stake Presidency Second Counselor', 'presidency'],
  ['Stake Relief Society President', 'auxiliary'],
  ['Stake Young Women President', 'auxiliary'],
  ['Stake Primary President', 'auxiliary'],
]);

const emailKey = value => String(value ?? '').trim().toLowerCase();

function displayName(name) {
  const [last, first] = name.split(',').map(part => part.trim());
  return first ? `${first} ${last}` : last;
}

export function buildLeaders(stakeRows, unitRows, submissions, units, missions) {
  const byEmail = new Map(submissions.map(row => [emailKey(row.email), row]));
  const cards = [];
  const slots = new Set();

  function add({ slot, name, role, email, group, unit }) {
    if (!name || /vacant/i.test(name)) return;
    if (slots.has(slot)) throw new Error(`Org chart has multiple people for ${slot}`);
    slots.add(slot);
    const profile = emailKey(email) ? byEmail.get(emailKey(email)) : null;
    if (!profile?.permission) return;
    const mission = profile.mission;
    const country = missions.find(item => item.name.toLowerCase() === mission?.toLowerCase())?.country;
    cards.push({
      slug: slot, name: displayName(name), role, group,
      unitId: unit?.id, ward: unit?.name, buildingId: unit?.building,
      mission, missionCountry: country ?? profile.missionCountry,
      birthplace: profile.birthplace, scripture: profile.scripture,
      hobbies: profile.hobbies, family: profile.family, hymn: profile.hymn,
      _sourcePhotos: profile.photoUrls.slice(0, 1).map(url => ({ kind: 'drive', url })),
    });
  }

  if (stakeRows[0]?.[1] !== 'Position' || stakeRows[0]?.[7] !== 'Email' ||
      unitRows[0]?.[1] !== 'Calling' || unitRows[0]?.[3] !== 'Email') {
    throw new Error('Van Stake Org Chart column layout changed');
  }
  for (const [ward, role, name, email] of unitRows.slice(1)) {
    if (!['Bishop', 'Branch President'].includes(role?.trim())) continue;
    const unit = matchUnit(ward === 'Vancouver Wah Yan Ward (Chinese)' ? 'Vancouver Wah Yan Wan (Chinese)' : ward, units);
    if (!unit) throw new Error(`No map unit for org chart ward "${ward}"`);
    add({ slot: unit.id, name, role: role.trim(), email, group: 'unit', unit });
  }
  for (const [, role, name, , , , , email] of stakeRows.slice(1)) {
    const group = stakeRoles.get(role);
    if (group) add({ slot: role.toLowerCase().replaceAll(' ', '-'), name, role, email, group });
  }
  return cards;
}
