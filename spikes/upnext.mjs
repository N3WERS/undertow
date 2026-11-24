import { Innertube } from 'youtubei.js'
const id = process.argv[2] || 'dQw4w9WgXcQ'
const yt = await Innertube.create({ retrieve_player: false, lang: 'ru', location: 'RU' })
const panel = await yt.music.getUpNext(id)
const rows = panel.contents || []
console.log('n', rows.length)
const first = rows[0]
console.log('keys', Object.keys(first || {}))
console.dir({ type: first?.type, id: first?.id, title: first?.title?.toString?.(), artists: first?.artists?.map(a=>a.name), duration: first?.duration?.text, album: first?.album?.name }, { depth: 4 })
