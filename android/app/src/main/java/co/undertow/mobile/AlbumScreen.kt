package co.undertow.mobile

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage

@Composable
fun AlbumScreen(
    ref: AlbumRef,
    repo: MusicRepository,
    saved: Boolean,
    downloads: Map<String, java.io.File>,
    downloading: Set<String>,
    likedKeys: Set<String>,
    activeKey: String?,
    onBack: () -> Unit,
    onSave: (AlbumItem) -> Unit,
    onPlay: (TrackItem, List<TrackItem>) -> Unit,
    onLike: (TrackItem) -> Unit,
    onDownload: (TrackItem) -> Unit,
    onAddToPlaylist: (TrackItem) -> Unit
) {
    var album by remember(ref.url) { mutableStateOf<AlbumItem?>(null) }
    var loading by remember(ref.url) { mutableStateOf(true) }
    var error by remember(ref.url) { mutableStateOf<String?>(null) }

    LaunchedEffect(ref.url) {
        loading = true
        error = null
        try {
            album = repo.album(ref.url, ref.artist)
        } catch (e: Exception) {
            error = e.message ?: "Не удалось открыть альбом"
        } finally {
            loading = false
        }
    }

    Column(Modifier.fillMaxSize()) {
        Row(
            Modifier.fillMaxWidth().padding(start = 8.dp, end = 16.dp, top = 2.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            IconButton(onClick = onBack) {
                Icon(Icons.Rounded.ArrowBack, contentDescription = "Назад", tint = TextMain)
            }
            Text("Альбом", color = TextMain, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
        }

        when {
            loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = Teal, strokeWidth = 2.dp)
            }
            error != null -> Column(Modifier.padding(24.dp)) {
                Text(error ?: "Ошибка", color = Color(0xFFFF9A9A), fontSize = 12.5.sp)
            }
            album != null -> AlbumContent(
                album = album!!,
                saved = saved,
                downloads = downloads,
                downloading = downloading,
                likedKeys = likedKeys,
                activeKey = activeKey,
                onSave = onSave,
                onPlay = onPlay,
                onLike = onLike,
                onDownload = onDownload,
                onAddToPlaylist = onAddToPlaylist
            )
        }
    }
}

@Composable
private fun AlbumContent(
    album: AlbumItem,
    saved: Boolean,
    downloads: Map<String, java.io.File>,
    downloading: Set<String>,
    likedKeys: Set<String>,
    activeKey: String?,
    onSave: (AlbumItem) -> Unit,
    onPlay: (TrackItem, List<TrackItem>) -> Unit,
    onLike: (TrackItem) -> Unit,
    onDownload: (TrackItem) -> Unit,
    onAddToPlaylist: (TrackItem) -> Unit
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(bottom = 32.dp)
    ) {
        item {
            Column(
                Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                AsyncImage(
                    model = album.thumbnail,
                    contentDescription = null,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.size(184.dp).clip(RoundedCornerShape(16.dp)).background(Surface2)
                )
                Spacer(Modifier.height(14.dp))
                Text(
                    album.title,
                    color = TextMain,
                    fontSize = 20.sp,
                    fontWeight = FontWeight.Bold,
                    textAlign = TextAlign.Center,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )
                Spacer(Modifier.height(4.dp))
                Text(
                    "${album.artist} · ${album.tracks.size} ${albumTracksWord(album.tracks.size)}",
                    color = Muted,
                    fontSize = 11.5.sp
                )
                Spacer(Modifier.height(14.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Button(
                        onClick = { album.tracks.firstOrNull()?.let { onPlay(it, album.tracks) } },
                        shape = RoundedCornerShape(10.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = Teal, contentColor = Color(0xFF04100F)),
                        contentPadding = PaddingValues(horizontal = 18.dp, vertical = 10.dp)
                    ) {
                        Icon(Icons.Rounded.PlayArrow, contentDescription = null, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(5.dp))
                        Text("Слушать", fontSize = 12.5.sp, fontWeight = FontWeight.Bold)
                    }
                    OutlinedButton(
                        onClick = { onSave(album) },
                        enabled = !saved,
                        shape = RoundedCornerShape(10.dp),
                        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 10.dp)
                    ) {
                        if (saved) Icon(Icons.Rounded.Check, contentDescription = null, tint = Teal, modifier = Modifier.size(17.dp))
                        Spacer(Modifier.width(5.dp))
                        Text(if (saved) "В библиотеке" else "Сохранить", color = if (saved) Teal else TextMain, fontSize = 12.5.sp)
                    }
                }
            }
        }

        items(album.tracks, key = { it.key }) { track ->
            TrackRow(
                track = track,
                liked = likedKeys.contains(track.key),
                downloaded = downloads.containsKey(track.key),
                downloading = downloading.contains(track.key),
                active = activeKey == track.key,
                onPlay = { onPlay(track, album.tracks) },
                onLike = { onLike(track) },
                onDownload = { onDownload(track) },
                onAddToPlaylist = { onAddToPlaylist(track) }
            )
        }
    }
}

private fun albumTracksWord(n: Int): String {
    val mod100 = n % 100
    val mod10 = n % 10
    return when {
        mod100 in 11..14 -> "треков"
        mod10 == 1 -> "трек"
        mod10 in 2..4 -> "трека"
        else -> "треков"
    }
}

@Composable
fun SavedAlbumScreen(
    album: AlbumItem,
    downloads: Map<String, java.io.File>,
    downloading: Set<String>,
    likedKeys: Set<String>,
    activeKey: String?,
    onBack: () -> Unit,
    onPlay: (TrackItem, List<TrackItem>) -> Unit,
    onLike: (TrackItem) -> Unit,
    onDownload: (TrackItem) -> Unit,
    onAddToPlaylist: (TrackItem) -> Unit
) {
    Column(Modifier.fillMaxSize()) {
        Row(
            Modifier.fillMaxWidth().padding(start = 8.dp, end = 16.dp, top = 2.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            IconButton(onClick = onBack) {
                Icon(Icons.Rounded.ArrowBack, contentDescription = "Назад", tint = TextMain)
            }
            Text("Альбом · библиотека", color = TextMain, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
        }
        AlbumContent(
            album = album,
            saved = true,
            downloads = downloads,
            downloading = downloading,
            likedKeys = likedKeys,
            activeKey = activeKey,
            onSave = {},
            onPlay = onPlay,
            onLike = onLike,
            onDownload = onDownload,
            onAddToPlaylist = onAddToPlaylist
        )
    }
}
