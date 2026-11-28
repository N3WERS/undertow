/**
 * Обложки для маленьких поверхностей.
 *
 * YouTube Music отдаёт в списках hq720.jpg (1280×720), а строка библиотеки
 * рисует её в 40×40. Здесь мы просим у CDN подходящий размер: это меньше
 * трафика, меньше декодирования и заметно меньше памяти при прокрутке.
 *
 * `size` — желаемый размер в CSS-пикселях с запасом на retina.
 */
const YT_THUMB =
  /^(https?:\/\/i\.ytimg\.com\/vi\/[^/]+\/)(hq720|hqdefault|mqdefault|sddefault|maxresdefault)(\.jpg.*)$/

export function coverAt(url: string | undefined, size: number): string | undefined {
  if (!url) return undefined

  const yt = YT_THUMB.exec(url)
  if (yt) {
    const name = size <= 160 ? 'mqdefault' : size <= 360 ? 'hqdefault' : 'maxresdefault'
    return `${yt[1]}${name}${yt[3]}`
  }

  // Обложки YouTube Music: ...=w544-h544-l90-rj
  if (/=w\d+-h\d+/.test(url)) {
    const px = Math.max(80, Math.min(640, Math.round(size)))
    return url.replace(/=w\d+-h\d+/, `=w${px}-h${px}`)
  }

  // SoundCloud: ...-t500x500.jpg
  if (url.includes('sndcdn.com')) {
    const px = size <= 160 ? 120 : size <= 360 ? 200 : 500
    return url.replace(/-t\d+x\d+(?=\.)/, `-t${px}x${px}`)
  }

  return url
}
