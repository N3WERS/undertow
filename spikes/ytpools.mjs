import { Innertube } from 'youtubei.js'
const yt = await Innertube.create({ retrieve_player: false, lang: 'ru', location: 'RU' })
const t0 = Date.now()
const ms = () => `${Date.now() - t0}ms`
const a = await yt.music.getArtist('UCTb8GTCVjJMLVzZ71wl3zWQ').catch(() => null)
console.log('artist', a?.header?.title?.toString?.(), ms())
// берём похожих как в проде
const page = await yt.music.getArtist('UC1gaCs5yFtrMW0OXNdtqyAQ')
const rel = page.sections.find((x) => /Похожие/i.test(x.header?.title?.toString?.() ?? ''))
const ids = rel.contents.slice(0, 7).map((c) => c.id)
console.log('related ids', ids.length, ms())
const one = async (id) => {
  const s = Date.now()
  try {
    const p = await yt.music.getArtist(id)
    const shelf = p.sections.find((x) => x.type === 'MusicShelf')
    const full = await shelf.endpoint.call(yt.actions, { client: 'YTMUSIC', parse: true })
    const n = full.contents_memo.get('MusicPlaylistShelf')[0].contents.length
    return `${p.header?.title?.toString?.()}:${n} ${Date.now() - s}ms`
  } catch (e) {
    return `FAIL ${id} ${e.message} ${Date.now() - s}ms`
  }
}
const t1 = Date.now()
const res = await Promise.all(ids.map(one))
console.log('parallel all:', Date.now() - t1, 'ms\n', res)
