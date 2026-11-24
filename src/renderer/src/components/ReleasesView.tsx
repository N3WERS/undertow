import type { ReleaseItem } from '../types'
import { IconPlay, IconRefresh, IconSpark } from './Icons'

interface Data {
  loading: boolean
  items: ReleaseItem[]
  updatedAt: number
  artists: number
}

interface Props {
  data: Data | null
  onRefresh: () => void
  onOpenAlbum: (rel: ReleaseItem) => void
  onArtist: (rel: ReleaseItem) => void
  onPlay: (rel: ReleaseItem) => void
}

const MONTHS = [
  'январь',
  'февраль',
  'март',
  'апрель',
  'май',
  'июнь',
  'июль',
  'август',
  'сентябрь',
  'октябрь',
  'ноябрь',
  'декабрь'
]
const MONTHS_GEN = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря'
]

const TYPE_LABEL: Record<ReleaseItem['type'], string> = {
  single: 'сингл',
  ep: 'EP',
  album: 'альбом'
}

function parts(date?: string): { y?: string; m?: number; d?: number } {
  if (!date) return {}
  const [y, m, d] = date.split('-')
  return { y, m: m ? Number(m) : undefined, d: d ? Number(d) : undefined }
}

function dateLabel(date?: string): string {
  const { y, m, d } = parts(date)
  if (!y) return 'без даты'
  if (m && d) return `${d} ${MONTHS_GEN[m - 1]} ${y}`
  if (m) return `${MONTHS[m - 1]} ${y}`
  return y
}

/**
 * Группируем по году, а не по месяцу: у части релизов известен только год,
 * и тогда «2026» и «октябрь 2026» рисовались бы двумя блоками подряд.
 */
function yearGroup(date?: string): { key: string; label: string } {
  const { y } = parts(date)
  if (!y) return { key: 'unknown', label: 'Без даты' }
  return { key: y, label: y }
}

function playsLabel(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.', ',')} млн`
  if (n >= 10_000) return `${Math.round(n / 1000)} тыс`
  if (n >= 1_000) return `${(n / 1000).toFixed(1).replace('.', ',')} тыс`
  return String(n)
}

function ageDays(date?: string): number | null {
  if (!date) return null
  const t = Date.parse(date)
  if (!Number.isFinite(t)) return null
  return (Date.now() - t) / 86_400_000
}

function updatedLabel(ts: number): string {
  if (!ts) return ''
  return new Date(ts).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export default function ReleasesView({ data, onRefresh, onOpenAlbum, onArtist, onPlay }: Props) {
  const items = data?.items ?? []
  const loading = data?.loading ?? true

  // сохраняем порядок (он уже по дате) и режем на месяцы
  const groups: { key: string; label: string; items: ReleaseItem[] }[] = []
  for (const rel of items) {
    const g = yearGroup(rel.date ?? rel.year)
    const last = groups[groups.length - 1]
    if (last && last.key === g.key) last.items.push(rel)
    else groups.push({ key: g.key, label: g.label, items: [rel] })
  }

  return (
    <div className="releases-page">
      <div className="page-head">
        <div>
          <h1>Новинки</h1>
          <p>
            {loading && !items.length
              ? 'Смотрю, что нового у артистов из библиотеки…'
              : items.length
                ? `Последние релизы ${data?.artists ?? 0} артистов из вашей библиотеки`
                : 'Здесь появятся свежие релизы артистов, которых вы слушаете'}
          </p>
        </div>
        <button className="ghost-btn" onClick={onRefresh} disabled={loading} title="Проверить новинки заново">
          <IconRefresh width={14} height={14} />
          {loading ? 'обновляю…' : 'обновить'}
        </button>
      </div>

      {loading && !items.length ? (
        <div className="rel-grid rel-skeleton-grid">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="rel-skeleton" style={{ animationDelay: `${i * 60}ms` }}>
              <div className="rel-skeleton-cover" />
              <div className="rel-skeleton-line" />
              <div className="rel-skeleton-line short" />
            </div>
          ))}
        </div>
      ) : !items.length ? (
        <div className="empty rel-empty">
          <IconSpark width={26} height={26} />
          <b>Пока тихо</b>
          <span>
            Новинки собираются по артистам из вашей библиотеки: слушайте и лайкайте треки, и через пару треков здесь
            появится свежий релиз.
          </span>
        </div>
      ) : (
        <>
          {data?.updatedAt ? (
            <div className="rel-updated">обновлено {updatedLabel(data.updatedAt)}</div>
          ) : null}
          {groups.map((g) => (
            <section key={g.key} className="rel-group">
              <div className="rel-group-head">
                <h2>{g.label}</h2>
                <span>{g.items.length}</span>
              </div>
              <div className="rel-grid">
                {g.items.map((rel) => {
                  const fresh = (ageDays(rel.date) ?? 999) <= 30
                  return (
                    <article key={rel.id} className={`rel-card${fresh ? ' fresh' : ''}`}>
                      <div className="rel-cover" onClick={() => onOpenAlbum(rel)}>
                        {rel.coverUrl ? (
                          <img src={rel.coverUrl} alt="" loading="lazy" />
                        ) : (
                          <div className="rel-cover-fallback">{rel.title.slice(0, 1)}</div>
                        )}
                        <span className={`rel-type ${rel.type}`}>{TYPE_LABEL[rel.type]}</span>
                        {fresh ? <span className="rel-new">new</span> : null}
                        <button
                          className="rel-play"
                          onClick={(e) => {
                            e.stopPropagation()
                            onPlay(rel)
                          }}
                          title="Слушать релиз"
                        >
                          <IconPlay width={16} height={16} />
                        </button>
                      </div>
                      <div className="rel-info">
                        <button className="rel-title" onClick={() => onOpenAlbum(rel)} title={rel.title}>
                          {rel.title}
                        </button>
                        <button className="rel-artist" onClick={() => onArtist(rel)} title={rel.artist}>
                          {rel.artist}
                        </button>
                        <div className="rel-foot">
                          <span className="rel-date" title={rel.dateSource ? `дата: ${rel.dateSource}` : undefined}>
                            {dateLabel(rel.date)}
                          </span>
                          {rel.plays ? (
                            <span className="rel-plays" title={`просмотры: ${rel.playsSource ?? 'YouTube'}`}>
                              <IconPlay width={9} height={9} />
                              {playsLabel(rel.plays)}
                              <i>{rel.playsSource ?? 'YouTube'}</i>
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </article>
                  )
                })}
              </div>
            </section>
          ))}
        </>
      )}
    </div>
  )
}
