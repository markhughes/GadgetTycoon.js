// Saved games, kept in the browser's localStorage (the original writes DATA\SAVE\<name>.SAV).
const INDEX = 'gadgetTycoon.saves';
const PREFIX = 'gadgetTycoon.save.';

function readIndex() {
  try { return JSON.parse(localStorage.getItem(INDEX) || '[]'); } catch { return []; }
}

export function listSaves() {
  return readIndex().sort((a, b) => b.date - a.date);
}

export function writeSave(name, data) {
  const index = readIndex().filter((s) => s.name !== name);
  index.push({ name, date: Date.now() });
  localStorage.setItem(PREFIX + name, JSON.stringify(data));
  localStorage.setItem(INDEX, JSON.stringify(index));
}

export function readSave(name) {
  const raw = localStorage.getItem(PREFIX + name);
  return raw ? JSON.parse(raw) : null;
}

export function deleteSave(name) {
  localStorage.removeItem(PREFIX + name);
  localStorage.setItem(INDEX, JSON.stringify(readIndex().filter((s) => s.name !== name)));
}
