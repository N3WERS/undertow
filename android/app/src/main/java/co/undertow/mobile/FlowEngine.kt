package co.undertow.mobile

import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.sync.withPermit
import kotlin.math.max
import kotlin.random.Random

data class FlowSeed(val name: String, val weight: Int)
data class FlowStart(val seeds: List<FlowSeed>, val tracks: List<TrackItem>)

/**
 * «Течение» — бесконечный поток рекомендаций, повторяющий логику desktop:
 * семена из любимых артистов, соседи по поиску YouTube Music, пулы артистов
 * по кругу, примерно один свой трек на двадцать и второй круг соседей.
 */
class FlowEngine(private val repo: MusicRepository) {
    private val mutex = Mutex()
    private var session: Session? = null
    private var lastOpenedArtist = ""

    private data class Pool(
        val name: String,
        val tracks: MutableList<TrackItem>
    )

    private class Session(
        val seeds: List<FlowSeed>,
        val used: MutableSet<String>,
        val keys: MutableSet<String>,
        val pools: MutableList<Pool>,
        val artists: MutableList<String>,
        val known: MutableSet<String>,
        val libraryIds: Set<String>,
        val shelf: List<TrackItem>,
        var sinceLibrary: Int,
        var ring: Int,
        var cursor: Int
    )

    suspend fun start(likes: List<TrackItem>, history: List<TrackItem>): FlowStart = mutex.withLock {
        val weights = artistWeights(likes, history)
        if (weights.size < 2) {
            throw IllegalStateException(
                "В библиотеке мало артистов: лайкни несколько треков, и течение соберётся"
            )
        }

        val seedWeights = pickSeeds(weights, SEEDS).shuffled()
        val seedProfiles = mapLimit(seedWeights, 3) { seed ->
            val found = artistTracks(seed.name)
            if (found.isEmpty()) null else seed to found
        }.filterNotNull()

        if (seedProfiles.isEmpty()) {
            throw IllegalStateException("Не удалось собрать течение: попробуй ещё раз")
        }

        val libraryIds = (likes + history).map { it.key }.toSet()
        val known = seedProfiles.map { normalize(it.first.name) }.toMutableSet()

        // Соседи: артисты, которые чаще всего попадаются в выдаче семян.
        val counts = LinkedHashMap<String, Int>()
        for ((seed, tracks) in seedProfiles) {
            val seedKey = normalize(seed.name)
            for (track in tracks) {
                val artist = artistOf(track)
                val key = normalize(artist)
                if (key.isBlank() || key == seedKey || key == "youtube") continue
                if (known.contains(key)) continue
                counts[artist] = (counts[artist] ?: 0) + 1
            }
        }
        val neighbours = counts.entries
            .sortedByDescending { it.value }
            .map { it.key }
            .take(NEIGHBOURS)
        for (name in neighbours) known.add(normalize(name))

        val neighbourProfiles = mapLimit(neighbours, 3) { name ->
            val found = artistTracks(name)
            if (found.isEmpty()) null else name to found
        }.filterNotNull()

        val used = mutableSetOf<String>()
        val keys = mutableSetOf<String>()
        val pools = poolsFrom(
            seedProfiles.map { Profile(it.first.name, it.second) } +
                neighbourProfiles.map { Profile(it.first, it.second) },
            libraryIds,
            used,
            keys
        ).shuffled().toMutableList()

        if (pools.isEmpty()) {
            throw IllegalStateException("Не удалось набрать треки: попробуй ещё раз")
        }

        val shelf = likes.shuffled().take(40)
        val artists = (seedProfiles.map { it.first.name } + neighbourProfiles.map { it.first })
            .distinct()
            .toMutableList()
        val seeds = seedProfiles.map { FlowSeed(it.first.name, it.first.weight) }

        val s = Session(
            seeds = seeds,
            used = used,
            keys = keys,
            pools = pools,
            artists = artists,
            known = known,
            libraryIds = libraryIds,
            shelf = shelf,
            sinceLibrary = LIBRARY_GAP,
            ring = 1,
            cursor = Random.nextInt(max(1, pools.size))
        )
        val tracks = draw(s, FIRST_FILL).toMutableList()
        if (tracks.isEmpty()) throw IllegalStateException("Не удалось набрать треки")
        session = s
        reorderFirst(tracks)
        FlowStart(seeds, tracks)
    }

    suspend fun more(): List<TrackItem> = mutex.withLock {
        val s = session ?: return emptyList()
        var batch = draw(s, REFILL)
        if (batch.size < 8 && expand(s)) {
            batch = batch + draw(s, REFILL - batch.size)
        }
        batch
    }

    private fun reorderFirst(tracks: MutableList<TrackItem>) {
        if (tracks.isEmpty()) return
        val first = artistOf(tracks[0]).lowercase()
        if (first == lastOpenedArtist) {
            val alt = tracks.indexOfFirst { track ->
                artistOf(track).lowercase() != lastOpenedArtist
            }
            if (alt in 1..7) {
                tracks.add(0, tracks.removeAt(alt))
            }
        }
        lastOpenedArtist = artistOf(tracks[0]).lowercase()
    }

    private suspend fun expand(s: Session): Boolean {
        val anchors = s.artists.take(5)
        if (anchors.isEmpty()) return false

        val scans = mapLimit(anchors, 3) { name ->
            repo.search(name, songsOnly = true).take(20)
        }
        val counts = LinkedHashMap<String, Int>()
        for (tracks in scans.filterNotNull()) {
            for (track in tracks) {
                val artist = artistOf(track)
                val key = normalize(artist)
                if (key.isBlank() || key == "youtube" || s.known.contains(key)) continue
                counts[artist] = (counts[artist] ?: 0) + 1
            }
        }
        val candidates = counts.entries
            .sortedByDescending { it.value }
            .map { it.key }
            .take(RING2_PICKS)
        if (candidates.isEmpty()) return false
        for (name in candidates) s.known.add(normalize(name))

        val profiles = mapLimit(candidates, 3) { name ->
            val found = artistTracks(name)
            if (found.isEmpty()) null else name to found
        }.filterNotNull()
        if (profiles.isEmpty()) return false

        val pools = poolsFrom(
            profiles.map { Profile(it.first, it.second) },
            s.libraryIds,
            s.used,
            s.keys
        )
        if (pools.isEmpty()) return false

        s.pools.addAll(pools)
        s.artists.addAll(profiles.map { it.first })
        s.ring = 2
        return true
    }

    private data class Profile(val name: String, val tracks: List<TrackItem>)

    private fun poolsFrom(
        profiles: List<Profile>,
        libraryIds: Set<String>,
        used: Set<String>,
        keys: MutableSet<String>
    ): List<Pool> {
        val pools = mutableListOf<Pool>()
        val seenArtists = mutableSetOf<String>()
        for (profile in profiles) {
            val artistKey = normalize(profile.name)
            if (artistKey.isBlank() || seenArtists.contains(artistKey)) continue
            seenArtists.add(artistKey)
            val tracks = mutableListOf<TrackItem>()
            for (track in profile.tracks.shuffled()) {
                if (track.key in libraryIds || track.key in used) continue
                val key = keyOf(track.title)
                if (key.isBlank() || keys.contains(key)) continue
                keys.add(key)
                tracks.add(track)
            }
            if (tracks.isNotEmpty()) {
                pools.add(Pool(profile.name, tracks))
            }
        }
        return pools
    }

    private fun draw(s: Session, want: Int): List<TrackItem> {
        val out = mutableListOf<TrackItem>()
        val deferred = mutableMapOf<Pool, MutableList<TrackItem>>()
        var guard = 0
        while (out.size < want && guard++ < want * 12) {
            val start = if (s.pools.isNotEmpty()) s.cursor % s.pools.size else 0
            val order = if (start == 0) s.pools else
                s.pools.drop(start) + s.pools.take(start)
            var advanced = false
            for (pool in order) {
                val last = if (out.isEmpty()) "" else artistOf(out.last()).lowercase()
                while (pool.tracks.isNotEmpty()) {
                    val track = pool.tracks.removeAt(0)
                    if (track.key in s.used) continue
                    if (last.isNotEmpty() && artistOf(track).lowercase() == last) {
                        deferred.getOrPut(pool) { mutableListOf() }.add(track)
                        continue
                    }
                    s.used.add(track.key)
                    out.add(track)
                    advanced = true
                    break
                }
                if (out.size >= want) break
            }
            for ((pool, list) in deferred) pool.tracks.addAll(list)
            deferred.clear()
            s.cursor++
            if (!advanced) break
        }

        s.sinceLibrary += out.size
        if (s.shelf.isNotEmpty() && s.sinceLibrary >= LIBRARY_GAP &&
            Random.nextDouble() < LIBRARY_CHANCE * out.size
        ) {
            val pick = s.shelf.filter { it.key !in s.used }.randomOrNull()
            if (pick != null) {
                s.used.add(pick.key)
                s.keys.add(keyOf(pick.title))
                out.add(max(1, out.size - 4), pick)
                s.sinceLibrary = 0
            }
        }
        return out
    }

    private suspend fun artistTracks(name: String): List<TrackItem> {
        val found = repo.search(name, songsOnly = true).take(30)
        val target = normalize(name)
        val exact = found.filter { normalize(artistOf(it)) == target }
        return if (exact.isNotEmpty()) exact else found
    }

    private fun artistWeights(
        likes: List<TrackItem>,
        history: List<TrackItem>
    ): List<FlowSeed> {
        val score = LinkedHashMap<String, Int>()
        fun bump(track: TrackItem, weight: Int) {
            val name = artistOf(track)
            if (name.isBlank() || normalize(name) == "youtube") return
            score[name] = (score[name] ?: 0) + weight
        }
        likes.forEach { bump(it, 3) }
        history.forEach { bump(it, 1) }
        return score.entries
            .map { FlowSeed(it.key, it.value) }
            .sortedByDescending { it.weight }
    }

    private fun pickSeeds(weights: List<FlowSeed>, count: Int): List<FlowSeed> {
        return weights
            .take(16)
            .map { seed ->
                val jitter = seed.weight * (0.4 + Random.nextDouble() * 1.6)
                seed to jitter
            }
            .sortedByDescending { it.second }
            .take(count)
            .map { it.first }
    }

    private suspend fun <T, R> mapLimit(
        items: List<T>,
        limit: Int,
        block: suspend (T) -> R?
    ): List<R?> = coroutineScope {
        val gate = Semaphore(limit)
        items.map { item ->
            async {
                gate.withPermit {
                    runCatching { block(item) }.getOrNull()
                }
            }
        }.awaitAll()
    }

    private fun artistOf(track: TrackItem): String {
        var raw = track.artist.trim()
        raw = raw.replace(Regex("\\s*[-–—]\\s*Topic\\s*$", RegexOption.IGNORE_CASE), "")
        raw = raw.split(Regex("\\s+(feat\\.?|ft\\.?|featuring)\\s+", RegexOption.IGNORE_CASE))
            .firstOrNull().orEmpty()
        raw = raw.split(",").firstOrNull().orEmpty()
        return raw.trim().ifBlank { track.artist.trim() }
    }

    private fun normalize(value: String): String {
        return value.lowercase()
            .replace('ё', 'е')
            .replace(Regex("[^\\p{L}\\p{N}]+"), " ")
            .trim()
    }

    /** Ключ трека по названию без фитов, скобок и порядка слов. */
    private fun keyOf(title: String): String {
        val clean = title.lowercase()
            .replace('ё', 'е')
            .replace(Regex("\\([^)]*\\)|\\[[^]]*]"), " ")
            .replace(Regex("[^\\p{L}\\p{N}]+"), " ")
            .trim()
        return clean.split(" ")
            .filter { it.isNotBlank() }
            .distinct()
            .sorted()
            .joinToString(" ")
    }

    private companion object {
        const val SEEDS = 6
        const val NEIGHBOURS = 10
        const val RING2_PICKS = 6
        const val FIRST_FILL = 30
        const val REFILL = 20
        const val LIBRARY_CHANCE = 0.06
        const val LIBRARY_GAP = 12
    }
}
