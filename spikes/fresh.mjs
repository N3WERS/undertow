import { Innertube } from 'youtubei.js'
const yt = await Innertube.create({ lang: 'ru', location: 'RU' })
const q = process.argv[2] ?? 'MACAN'
const res = await yt.music.search(q)
const walk = (n, out=[]) => { if(!n) return out; if(Array.isArray(n)){n.forEach(x=>walk(x,out));return out} if(typeof n==='object'){ if(n.constructor?.name==='MusicResponsiveListItem') out.push(n); for(const k of Object.keys(n)) walk(n[k],out)} return out }
const artists = walk(res.contents).filter(i=>i.item_type==='artist')
const a = artists.find(x=>/MACAN/i.test(x.name?.toString?.()||'')) ?? artists[0]
const page = await yt.music.getArtist(a.id)
for (const s of page.sections ?? []) {
  const items = s.contents ?? []
  const types = [...new Set(items.map(i=>i.item_type))]
  console.log('SECTION', s.type, '|', s.title?.toString?.(), '| n=', items.length, '| types', types.join(','))
  if (s.type !== 'MusicShelf') {
    for (const it of items.slice(0, 6)) {
      console.log('   ', JSON.stringify({id: it.id, title: it.title?.toString?.() ?? it.name?.toString?.(), subtitle: it.subtitle?.toString?.(), year: it.year, type: it.item_type, views: it.views?.toString?.()}))
    }
  }
}
