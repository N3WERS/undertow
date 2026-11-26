package co.undertow.mobile

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

class LibraryStore(context: Context) {
    private val prefs = context.getSharedPreferences("undertow.mobile", Context.MODE_PRIVATE)
    val downloadDir: File = File(context.filesDir, "downloads").apply { mkdirs() }

    fun loadLikes(): List<TrackItem> {
        val raw = prefs.getString("likes", null) ?: return emptyList()
        return runCatching {
            val arr = JSONArray(raw)
            buildList {
                for (i in 0 until arr.length()) {
                    TrackItem.fromJson(arr.getJSONObject(i))?.let(::add)
                }
            }
        }.getOrDefault(emptyList())
    }

    fun saveLikes(items: List<TrackItem>) {
        val arr = JSONArray()
        items.forEach { arr.put(it.toJson()) }
        prefs.edit().putString("likes", arr.toString()).apply()
    }

    fun loadDownloads(): Map<String, File> {
        val raw = prefs.getString("downloads", null) ?: return emptyMap()
        return runCatching {
            val obj = JSONObject(raw)
            buildMap {
                obj.keys().forEach { key ->
                    val name = obj.optString(key)
                    val file = File(downloadDir, name)
                    if (name.isNotBlank() && file.exists()) put(key, file)
                }
            }
        }.getOrDefault(emptyMap())
    }

    fun saveDownloads(items: Map<String, File>) {
        val obj = JSONObject()
        items.forEach { (key, file) -> obj.put(key, file.name) }
        prefs.edit().putString("downloads", obj.toString()).apply()
    }

    fun loadDownloadTracks(): List<TrackItem> {
        val raw = prefs.getString("downloadTracks", null) ?: return emptyList()
        return runCatching {
            val arr = JSONArray(raw)
            buildList {
                for (i in 0 until arr.length()) TrackItem.fromJson(arr.getJSONObject(i))?.let(::add)
            }
        }.getOrDefault(emptyList())
    }

    fun saveDownloadTracks(items: List<TrackItem>) {
        val arr = JSONArray()
        items.forEach { arr.put(it.toJson()) }
        prefs.edit().putString("downloadTracks", arr.toString()).apply()
    }

    fun loadAudioQuality(): AudioQuality = AudioQuality.fromId(prefs.getString("audioQuality", null))

    fun saveAudioQuality(quality: AudioQuality) {
        prefs.edit().putString("audioQuality", quality.id).apply()
    }

    fun loadHistory(): List<HistoryEntry> {
        val raw = prefs.getString("history", null) ?: return emptyList()
        return runCatching {
            val arr = JSONArray(raw)
            buildList {
                for (i in 0 until arr.length()) HistoryEntry.fromJson(arr.getJSONObject(i))?.let(::add)
            }
        }.getOrDefault(emptyList())
    }

    fun recordPlay(track: TrackItem): List<HistoryEntry> {
        val next = listOf(HistoryEntry(track, System.currentTimeMillis())) +
            loadHistory().filterNot { it.track.key == track.key }
        saveHistory(next.take(200))
        return next
    }

    fun clearHistory(): List<HistoryEntry> {
        saveHistory(emptyList())
        return emptyList()
    }

    private fun saveHistory(items: List<HistoryEntry>) {
        val arr = JSONArray()
        items.forEach { arr.put(it.toJson()) }
        prefs.edit().putString("history", arr.toString()).apply()
    }

    fun loadAlbums(): List<AlbumItem> {
        val raw = prefs.getString("albums", null) ?: return emptyList()
        return runCatching {
            val arr = JSONArray(raw)
            buildList {
                for (i in 0 until arr.length()) AlbumItem.fromJson(arr.getJSONObject(i))?.let(::add)
            }
        }.getOrDefault(emptyList())
    }

    fun saveAlbums(items: List<AlbumItem>) {
        val arr = JSONArray()
        items.forEach { arr.put(it.toJson()) }
        prefs.edit().putString("albums", arr.toString()).apply()
    }

    fun loadPlaylists(): List<PlaylistItem> {
        val raw = prefs.getString("playlists", null) ?: return emptyList()
        return runCatching {
            val arr = JSONArray(raw)
            buildList {
                for (i in 0 until arr.length()) PlaylistItem.fromJson(arr.getJSONObject(i))?.let(::add)
            }
        }.getOrDefault(emptyList())
    }

    fun savePlaylists(items: List<PlaylistItem>) {
        val arr = JSONArray()
        items.forEach { arr.put(it.toJson()) }
        prefs.edit().putString("playlists", arr.toString()).apply()
    }

    fun fileFor(track: TrackItem, ext: String): File {
        val safe = ext.lowercase().replace(Regex("[^a-z0-9]"), "").ifBlank { "m4a" }
        return File(downloadDir, "${track.key}.$safe")
    }
}
