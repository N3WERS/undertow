package co.undertow.mobile

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.schabi.newpipe.extractor.NewPipe
import org.schabi.newpipe.extractor.channel.ChannelInfoItem
import org.schabi.newpipe.extractor.playlist.PlaylistInfo
import org.schabi.newpipe.extractor.playlist.PlaylistInfoItem
import org.schabi.newpipe.extractor.search.SearchInfo
import org.schabi.newpipe.extractor.services.youtube.linkHandler.YoutubeSearchQueryHandlerFactory
import org.schabi.newpipe.extractor.stream.StreamInfoItem

class MusicRepository {
    init {
        NewPipe.init(DownloaderImpl())
    }

    private fun StreamInfoItem.toTrack(): TrackItem = TrackItem(
        url = url,
        title = name,
        artist = uploaderName.ifBlank { "YouTube" },
        duration = duration,
        durationText = fmtDuration(duration),
        thumbnail = thumbnails.lastOrNull()?.url
    )

    private fun searchItems(service: org.schabi.newpipe.extractor.StreamingService, query: String, filters: List<String>): List<org.schabi.newpipe.extractor.InfoItem> {
        val handler = service.searchQHFactory.fromQuery(query, filters, null)
        return SearchInfo.getInfo(service, handler).relatedItems
    }

    suspend fun search(query: String, songsOnly: Boolean = false): List<TrackItem> = withContext(Dispatchers.IO) {
        val service = NewPipe.getService(0)
        val filters = if (songsOnly) listOf(YoutubeSearchQueryHandlerFactory.MUSIC_SONGS) else emptyList()
        val items = searchItems(service, query, filters)
            .filterIsInstance<StreamInfoItem>()
            .filter { it.url.isNotBlank() }
            .map { it.toTrack() }
        if (items.isEmpty() && songsOnly) {
            searchItems(service, query, emptyList())
                .filterIsInstance<StreamInfoItem>()
                .filter { it.url.isNotBlank() }
                .map { it.toTrack() }
        } else items
    }

    suspend fun albumSearch(query: String): List<AlbumRef> = withContext(Dispatchers.IO) {
        val service = NewPipe.getService(0)
        searchItems(service, query, listOf(YoutubeSearchQueryHandlerFactory.MUSIC_ALBUMS))
            .filterIsInstance<PlaylistInfoItem>()
            .filter { it.url.isNotBlank() }
            .map { item ->
                AlbumRef(
                    url = item.url,
                    title = item.name,
                    artist = item.uploaderName.ifBlank { "YouTube Music" },
                    thumbnail = item.thumbnails.lastOrNull()?.url,
                    trackCount = item.streamCount
                )
            }
    }

    suspend fun artistSearch(query: String): List<ArtistRef> = withContext(Dispatchers.IO) {
        val service = NewPipe.getService(0)
        searchItems(service, query, listOf(YoutubeSearchQueryHandlerFactory.MUSIC_ARTISTS))
            .filterIsInstance<ChannelInfoItem>()
            .filter { it.url.isNotBlank() && it.name.isNotBlank() }
            .map { item ->
                ArtistRef(
                    url = item.url,
                    name = item.name,
                    avatar = item.thumbnails.lastOrNull()?.url
                )
            }
    }

    suspend fun album(url: String, fallbackArtist: String? = null): AlbumItem = withContext(Dispatchers.IO) {
        val service = NewPipe.getService(0)
        val info = PlaylistInfo.getInfo(service, url)
        val tracks = info.relatedItems
            .filterIsInstance<StreamInfoItem>()
            .filter { it.url.isNotBlank() }
            .map { it.toTrack() }
        if (tracks.isEmpty()) throw IllegalStateException("В альбоме нет треков")
        val cleanTitle = info.name
            .removePrefix("Album – ").removePrefix("Album - ")
            .removePrefix("Альбом – ").removePrefix("Альбом - ")
            .trim()
        val artist = info.uploaderName
            .takeIf { it.isNotBlank() && it != "YouTube Music" }
            ?: fallbackArtist?.takeIf { it.isNotBlank() }
            ?: "YouTube Music"
        AlbumItem(
            url = url,
            title = cleanTitle.ifBlank { info.name },
            artist = artist,
            thumbnail = info.thumbnails.lastOrNull()?.url,
            tracks = tracks
        )
    }

    suspend fun audioSource(track: TrackItem, quality: AudioQuality = AudioQuality.AUTO): AudioSource = withContext(Dispatchers.IO) {
        val service = NewPipe.getService(0)
        val extractor = service.getStreamExtractor(track.url)
        extractor.fetchPage()
        val all = extractor.audioStreams.filter { it.content != null }
        val measured = all.filter { it.averageBitrate > 0 }
        val target = when (quality) {
            AudioQuality.AUTO -> 0
            AudioQuality.HIGH -> 160
            AudioQuality.MEDIUM -> 96
            AudioQuality.LOW -> 64
        }
        val stream = if (target == 0) {
            all.maxByOrNull { it.averageBitrate }
        } else {
            val pool = measured.ifEmpty { all }
            pool.filter { it.averageBitrate >= target }.minByOrNull { it.averageBitrate }
                ?: pool.minByOrNull { kotlin.math.abs(it.averageBitrate - target) }
        } ?: throw IllegalStateException("Не нашёл аудиопоток")
        AudioSource(
            url = stream.content,
            ext = stream.format?.suffix?.takeIf { it.isNotBlank() } ?: "m4a",
            bitrateKbps = stream.averageBitrate.coerceAtLeast(0)
        )
    }

    suspend fun chart(scope: String = "ru"): List<TrackItem> = withContext(Dispatchers.IO) {
        val id = when (scope) {
            "us" -> "PL4fGSI1pDJn69On1f-8NAvX_CYlx7QyZc"
            "world" -> "PL4fGSI1pDJn6puJdseH2Rt9sMvt9E2M4i"
            else -> "PL4fGSI1pDJn5C8dBiYt0BTREyCHbZ47qc"
        }
        val service = NewPipe.getService(0)
        val info = PlaylistInfo.getInfo(service, "https://www.youtube.com/playlist?list=$id")
        val tracks = info.relatedItems
            .filterIsInstance<StreamInfoItem>()
            .filter { it.url.isNotBlank() }
            .map { it.toTrack() }
            .take(100)
        if (tracks.isEmpty()) throw IllegalStateException("Чарт пуст")
        tracks
    }

}
