package co.undertow.mobile

import org.json.JSONArray
import org.json.JSONObject

data class TrackItem(
    val url: String,
    val title: String,
    val artist: String,
    val duration: Long,
    val durationText: String,
    val thumbnail: String?,
    val key: String = trackKey(url)
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("url", url)
        put("title", title)
        put("artist", artist)
        put("duration", duration)
        put("durationText", durationText)
        put("thumbnail", thumbnail ?: JSONObject.NULL)
        put("key", key)
    }

    companion object {
        fun fromJson(o: JSONObject): TrackItem? {
            val url = o.optString("url")
            val title = o.optString("title")
            if (url.isBlank() || title.isBlank()) return null
            return TrackItem(
                url = url,
                title = title,
                artist = o.optString("artist", "YouTube"),
                duration = o.optLong("duration", 0L),
                durationText = o.optString("durationText"),
                thumbnail = if (o.isNull("thumbnail")) null else o.optString("thumbnail").ifBlank { null },
                key = o.optString("key").ifBlank { trackKey(url) }
            )
        }
    }
}

enum class AudioQuality(val id: String) {
    AUTO("auto"),
    HIGH("high"),
    MEDIUM("medium"),
    LOW("low");

    companion object {
        fun fromId(id: String?): AudioQuality = entries.firstOrNull { it.id == id } ?: AUTO
    }
}

data class AudioSource(val url: String, val ext: String, val bitrateKbps: Int = 0)

fun trackKey(url: String): String {
    Regex("[?&]v=([A-Za-z0-9_-]{11})").find(url)?.groupValues?.getOrNull(1)?.let { return it }
    return Integer.toHexString(url.hashCode())
}

fun fmtDuration(seconds: Long): String {
    val sec = seconds.coerceAtLeast(0)
    return "%d:%02d".format(sec / 60, sec % 60)
}

fun fmtMs(ms: Long): String = fmtDuration(ms / 1000)

data class AlbumRef(
    val url: String,
    val title: String,
    val artist: String,
    val thumbnail: String?,
    val trackCount: Long
)

data class AlbumItem(
    val url: String,
    val title: String,
    val artist: String,
    val thumbnail: String?,
    val tracks: List<TrackItem>
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("url", url)
        put("title", title)
        put("artist", artist)
        put("thumbnail", thumbnail ?: JSONObject.NULL)
        val arr = JSONArray()
        tracks.forEach { arr.put(it.toJson()) }
        put("tracks", arr)
    }

    companion object {
        fun fromJson(o: JSONObject): AlbumItem? {
            val url = o.optString("url")
            val rawTitle = o.optString("title")
            if (url.isBlank() || rawTitle.isBlank()) return null
            val tracks = runCatching {
                val arr = o.optJSONArray("tracks") ?: JSONArray()
                buildList {
                    for (i in 0 until arr.length()) TrackItem.fromJson(arr.getJSONObject(i))?.let(::add)
                }
            }.getOrDefault(emptyList())
            val title = rawTitle
                .removePrefix("Album – ").removePrefix("Album - ")
                .removePrefix("Альбом – ").removePrefix("Альбом - ")
                .trim()
                .ifBlank { rawTitle }
            val rawArtist = o.optString("artist", "YouTube")
            val artist = if (rawArtist == "YouTube Music" && tracks.isNotEmpty()) tracks.first().artist else rawArtist
            return AlbumItem(
                url = url,
                title = title,
                artist = artist,
                thumbnail = if (o.isNull("thumbnail")) null else o.optString("thumbnail").ifBlank { null },
                tracks = tracks
            )
        }
    }
}

data class HistoryEntry(val track: TrackItem, val playedAt: Long) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("track", track.toJson())
        put("playedAt", playedAt)
    }

    companion object {
        fun fromJson(o: JSONObject): HistoryEntry? {
            val t = o.optJSONObject("track") ?: return null
            return TrackItem.fromJson(t)?.let { HistoryEntry(it, o.optLong("playedAt", 0L)) }
        }
    }
}

data class ArtistRef(
    val url: String,
    val name: String,
    val avatar: String?
)

data class PlaylistItem(
    val id: String,
    val name: String,
    val tracks: List<TrackItem>,
    val createdAt: Long,
    val coverUrl: String? = null
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("id", id)
        put("name", name)
        put("createdAt", createdAt)
        put("coverUrl", coverUrl ?: JSONObject.NULL)
        val arr = JSONArray()
        tracks.forEach { arr.put(it.toJson()) }
        put("tracks", arr)
    }

    companion object {
        fun fromJson(o: JSONObject): PlaylistItem? {
            val id = o.optString("id")
            val name = o.optString("name")
            if (id.isBlank() || name.isBlank()) return null
            val tracks = runCatching {
                val arr = o.optJSONArray("tracks") ?: JSONArray()
                buildList {
                    for (i in 0 until arr.length()) TrackItem.fromJson(arr.getJSONObject(i))?.let(::add)
                }
            }.getOrDefault(emptyList())
            return PlaylistItem(
                id = id,
                name = name,
                tracks = tracks,
                createdAt = o.optLong("createdAt", 0L),
                coverUrl = if (o.isNull("coverUrl")) null else o.optString("coverUrl").ifBlank { null }
            )
        }
    }
}
