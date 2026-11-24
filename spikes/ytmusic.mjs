// Spike 0: prove the audio pipeline works with no account and no token.
// search -> metadata -> playable URL -> real bytes -> charts ("новинки/популярное")
import { Innertube } from 'youtubei.js';

const QUERY = process.argv[2] ?? 'Molchat Doma sudno';
const t0 = Date.now();
const ms = () => `${Date.now() - t0}ms`;

const yt = await Innertube.create({ retrieve_player: true, lang: 'en', location: 'US' });
console.log(`[init] ${ms()}`);

// --- helpers -------------------------------------------------------------
function walk(node, out = []) {
  if (!node) return out;
  if (Array.isArray(node)) { for (const n of node) walk(n, out); return out; }
  if (typeof node === 'object') {
    if (node.constructor?.name === 'MusicResponsiveListItem') out.push(node);
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (v && typeof v === 'object') walk(v, out);
    }
  }
  return out;
}
const norm = (s) => ({ id: s.id, title: s.title?.toString(), artists: s.artists?.map((a) => a.name).join(', '), album: s.album?.name, dur: s.duration?.text, kind: s.item_type });

// --- 1. search -----------------------------------------------------------
const search = await yt.music.search(QUERY);
const items = walk(search.contents);
const songs = items.filter((i) => i.item_type === 'song');
console.log(`[search] "${QUERY}" -> ${items.length} items, ${songs.length} songs, ${ms()}`);
console.table(songs.slice(0, 5).map(norm));
if (!songs.length) { console.error('no songs'); process.exit(1); }

// --- 2. resolve playable url --------------------------------------------
const track = songs[0];
const info = await yt.getBasicInfo(track.id);
const fmt = info.chooseFormat({ type: 'audio', quality: 'best' });
const url = await fmt.decipher(yt.session.player);
console.log(`[stream] "${norm(track).title}" codec=${fmt.codec} bitrate=${fmt.bitrate} itag=${fmt.itag} len=${fmt.content_length}`);
console.log(`[stream] ${url.slice(0, 60)}...</URL>`);

// --- 3. real bytes ------------------------------------------------------
const res = await fetch(url, { headers: { range: 'bytes=0-262143' } });
const buf = Buffer.from(await res.arrayBuffer());
const head = buf.subarray(0, 8).toString('hex');
const magic = head.startsWith('4f676753') ? 'OGG/OPUS' : /^fff/.test(head) ? 'MP3' : head.startsWith('664c6143') ? 'FLAC' : 'unknown';
console.log(`[bytes] ${res.status} ${res.headers.get('content-type')} ${buf.length}B magic=${magic}`);

// --- 4. charts: popular / new -------------------------------------------
try {
  const charts = await yt.music.getCharts('US');
  const rows = walk(charts.current?.contents ?? charts.contents ?? []);
  console.log(`[charts] sections: ${Object.keys(charts).filter((k) => charts[k]).join(',')} | rows=${rows.length} | ${ms()}`);
  console.log('         sample:', rows.slice(0, 3).map((r) => r.title?.toString()).join(' / '));
} catch (e) { console.log('[charts] failed:', e.message); }

console.log(`[done] ${ms()}`);
