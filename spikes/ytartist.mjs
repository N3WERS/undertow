// Спайк: сколько «яндексоподобного» даёт YouTube Music — артист, топ-треки, альбомы, похожие.
import { Innertube } from 'youtubei.js'

const NAME = process.argv[2] ?? 'Big Baby Tape'
const t0 = Date.now()
const ms = () => `${Date.now() - t0}ms`
const yt = await Innertube.create({ retrieve_player: false, lang: 'ru', location: 'RU' })
console.log(`[init] ${ms()}`)

const step = async (label, fn) => {
  try {
    const v = await fn()
    console.log(`[${label}] ok ${ms()}`, v)
    return v
  } catch (e) {
    console.log(`[${label}] FAIL: ${e.message}`)
    return null
  }
}

const s = await yt.music.search(NAME, { type: 'artist' })
const items = (s.contents ?? []).flatMap((sec) => sec.contents ?? [])
const artistIds = items
  .filter((i) => i.item_type === 'artist' || i.id?.startsWith('UC'))
  .map((i) => ({ id: i.id, name: i.name?.toString?.() ?? i.title?.toString?.() }))
console.log('[search]', artistIds.slice(0, 3))

const a = await yt.music.getArtist(artistIds[0].id)
const shelfOf = (pred) => a.sections.find((x) => pred(x))
const rel = shelfOf((x) => x.contents?.[0]?.item_type === 'artist' || x.contents?.[0]?.subscribers)
const albs = shelfOf((x) => /Альбом/i.test(x.header?.title?.toString?.() ?? ''))
const shelf = shelfOf((x) => x.type === 'MusicShelf')

console.log('[artist]', {
  name: a.header?.title?.toString?.(),
  sections: a.sections.map((x) => [x.type, x.header?.title?.toString?.(), x.contents?.length]),
  related: rel?.contents?.slice(0, 5).map((c) => c.title?.toString?.() + '|' + c.id) ?? null
})
console.log('[shelf]', shelf?.title?.toString?.(), 'items=', shelf?.contents?.length, 'endpoint=', !!shelf?.endpoint)

// свои топ-треки через «ещё» (endpoint кнопки)
const allSongs = await step('allSongs', async () => {
  const page = await shelf.endpoint.call(yt.actions, { client: 'YTMUSIC', parse: true })
  const full = page.contents_memo?.getType('MusicPlaylistShelf')?.[0]
  return { n: full?.contents?.length, first: full?.contents?.slice(0, 2).map((x) => [x.id, x.title?.toString?.(), x.artists?.map((y) => y.name).join(',')]) }
})

const albumCard = albs?.contents?.[0]
console.log('[albumCard]', albumCard?.title?.toString?.(), albumCard?.id, albumCard?.year?.toString?.())
const alb = await step('album', async () => {
  const r = await yt.music.getAlbum(albumCard.id)
  return { title: r.header?.title?.toString?.(), n: r.contents?.length, first: [r.contents?.[0]?.id, r.contents?.[0]?.title?.toString?.()] }
})

const relFirst = rel?.contents?.[0]
if (relFirst) {
  const a2 = await yt.music.getArtist(relFirst.id)
  const s2 = a2.sections.find((x) => x.type === 'MusicShelf')
  console.log('[related artist]', relFirst.title?.toString?.(), 'shelf items=', s2?.contents?.length, 'endpoint=', !!s2?.endpoint)
  const more = await step('related allSongs', async () => {
    const page = await s2.endpoint.call(yt.actions, { client: 'YTMUSIC', parse: true })
    const full = page.contents_memo?.getType('MusicPlaylistShelf')?.[0]
    return { n: full?.contents?.length }
  })
}
console.log(`[done] ${ms()}`)
