let _magies = null;

export async function init() {
  if (_magies !== null) return;
  _magies = await fetch('/api/magies').then(r => r.json()).catch(() => []);
  if (!Array.isArray(_magies)) _magies = [];
}

export function getAllMagies() {
  return _magies || [];
}

export function getRandomMagies(count = 3) {
  const pool = [...(_magies || [])];
  const result = [];
  while (result.length < count && pool.length > 0) {
    result.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  return result;
}
