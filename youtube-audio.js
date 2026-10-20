// Import d'une piste audio depuis un lien YouTube (admin, onglets Musique et
// Effets sonores). Le serveur télécharge lui-même le binaire AUTONOME de
// yt-dlp dans le volume (`DATA_DIR/bin`) : aucune dépendance à installer dans
// l'image, et le binaire se rafraîchit seul (YouTube casse yt-dlp souvent).
//
// Pas de ffmpeg : on ne prend que la piste `m4a` que YouTube sert telle quelle,
// un format déjà accepté par `AUDIO_EXTENSIONS`. Aucun recodage.
//
// ⚠️ YouTube bloque régulièrement les IP de datacenter (« confirm you're not a
// bot ») : l'échec est NORMAL et doit remonter tel quel à l'admin, qui garde
// l'upload de fichier comme repli.
//
// Feuille : ne requiert que des modules Node.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const RELEASE = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/';
const REFRESH_MS = 3 * 24 * 3600 * 1000;
const RUN_TIMEOUT_MS = 150_000;
const MAX_BYTES = 30 * 1024 * 1024; // = plafond JSON des uploads audio (app.js)
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be']);

/** Le lien est-il un lien YouTube http(s) ? Seule forme acceptée : rien
 * d'autre n'est jamais passé à yt-dlp (il sait lire des centaines de sites). */
function isYoutubeUrl(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch { return false; }
  return (u.protocol === 'https:' || u.protocol === 'http:') && YOUTUBE_HOSTS.has(u.hostname.toLowerCase());
}

function assetName() {
  if (process.platform === 'darwin') return 'yt-dlp_macos';
  if (process.platform === 'linux') return process.arch === 'arm64' ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux';
  return null;
}

function run(bin, args) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: RUN_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        // La dernière ligne `ERROR:` est la seule qui dise quelque chose à l'admin.
        const lines = String(stderr || err.message).split('\n').map(l => l.trim()).filter(Boolean);
        const msg = lines.filter(l => l.startsWith('ERROR')).pop() || lines.pop() || 'échec de yt-dlp';
        return reject(new Error(msg.replace(/^ERROR:\s*/, '')));
      }
      resolve(String(stdout));
    });
  });
}

async function downloadBinary(target) {
  const name = assetName();
  if (!name) throw new Error(`plateforme non prise en charge (${process.platform})`);
  const res = await fetch(RELEASE + name, { redirect: 'follow', signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`téléchargement de yt-dlp impossible (HTTP ${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, buf, { mode: 0o755 });
  fs.renameSync(tmp, target);
}

/** Chemin du binaire, téléchargé ou rafraîchi au besoin. `YT_DLP_PATH`
 * (binaire déjà installé) court-circuite tout. */
async function ensureBinary(dataDir, { force = false } = {}) {
  if (process.env.YT_DLP_PATH) return process.env.YT_DLP_PATH;
  const target = path.join(dataDir, 'bin', 'yt-dlp');
  let stale = true;
  try { stale = Date.now() - fs.statSync(target).mtimeMs > REFRESH_MS; } catch { /* absent */ }
  if (force || stale) {
    try { await downloadBinary(target); }
    catch (e) { if (!fs.existsSync(target)) throw e; } // garder l'ancien plutôt que rien
  }
  return target;
}

let busy = false;

/**
 * Télécharge la piste audio d'un lien YouTube. Rend `{ buffer, ext: 'm4a',
 * title }` ou jette une erreur lisible. Un seul import à la fois.
 */
async function fetchYoutubeAudio(url, dataDir) {
  if (!isYoutubeUrl(url)) throw Object.assign(new Error('lien YouTube invalide'), { status: 400 });
  if (busy) throw Object.assign(new Error('un import YouTube est déjà en cours'), { status: 409 });
  busy = true;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-'));
  try {
    const args = [
      '--no-playlist', '--no-progress', '--no-warnings',
      '-f', 'bestaudio[ext=m4a]',
      '--max-filesize', String(MAX_BYTES),
      '-o', path.join(tmpDir, 'audio.%(ext)s'),
      '--print', 'title',
      '--no-simulate',
      '--', String(url).trim(),
    ];
    let bin = await ensureBinary(dataDir);
    let out;
    try { out = await run(bin, args); }
    catch (e) {
      // Un yt-dlp périmé est la panne la plus courante : un essai de plus
      // avec le dernier binaire avant de rendre l'erreur.
      if (process.env.YT_DLP_PATH) throw e;
      bin = await ensureBinary(dataDir, { force: true });
      out = await run(bin, args);
    }
    const file = fs.readdirSync(tmpDir).find(f => f.endsWith('.m4a'));
    if (!file) throw new Error('aucune piste m4a récupérée (vidéo trop longue ou format indisponible)');
    const buffer = fs.readFileSync(path.join(tmpDir, file));
    if (!buffer.length) throw new Error('fichier audio vide');
    return { buffer, ext: 'm4a', title: out.split('\n').map(l => l.trim()).filter(Boolean)[0] || '' };
  } finally {
    busy = false;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

module.exports = { isYoutubeUrl, fetchYoutubeAudio };
