package co.undertow.mobile

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ArrowBack
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
fun ArtistScreen(
    ref: ArtistRef,
    repo: MusicRepository,
    downloads: Map<String, java.io.File>,
    downloading: Set<String>,
    likedKeys: Set<String>,
    activeKey: String?,
    onBack: () -> Unit,
    onOpenAlbum: (AlbumRef) -> Unit,
    onPlay: (TrackItem, List<TrackItem>) -> Unit,
    onLike: (TrackItem) -> Unit,
    onDownload: (TrackItem) -> Unit,
    onAddToPlaylist: (TrackItem) -> Unit
) {
    var tracks by remember(ref.name) { mutableStateOf<List<TrackItem>>(emptyList()) }
    var albums by remember(ref.name) { mutableStateOf<List<AlbumRef>>(emptyList()) }
    var loading by remember(ref.name) { mutableStateOf(true) }
    var error by remember(ref.name) { mutableStateOf<String?>(null) }

    LaunchedEffect(ref.name) {
        loading = true
        error = null
        try {
            tracks = repo.search(ref.name, songsOnly = true).take(30)
            albums = runCatching { repo.albumSearch(ref.name).take(12) }.getOrDefault(emptyList())
            if (tracks.isEmpty() && albums.isEmpty()) error = "Ничего не нашлось"
        } catch (e: Exception) {
            error = e.message ?: "Не удалось загрузить артиста"
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
            Text("Артист", color = TextMain, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
        }

        when {
            loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = Teal, strokeWidth = 2.dp)
            }
            error != null && tracks.isEmpty() -> Text(
                error ?: "Ошибка",
                color = Color(0xFFFF9A9A),
                fontSize = 12.5.sp,
                modifier = Modifier.padding(24.dp)
            )
            else -> LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(bottom = 32.dp)
            ) {
                item {
                    Column(
                        Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 10.dp),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        AsyncImage(
                            model = ref.avatar,
                            contentDescription = null,
                            contentScale = ContentScale.Crop,
                            modifier = Modifier.size(112.dp).clip(CircleShape).background(Surface2)
                        )
                        Spacer(Modifier.height(12.dp))
                        Text(
                            ref.name,
                            color = TextMain,
                            fontSize = 22.sp,
                            fontWeight = FontWeight.Bold,
                            textAlign = TextAlign.Center,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis
                        )
                        Spacer(Modifier.height(4.dp))
                        Text(
                            "${tracks.size} ${artistTracksWord(tracks.size)} · ${albums.size} ${artistAlbumsWord(albums.size)}",
                            color = Muted,
                            fontSize = 11.5.sp
                        )
                        Spacer(Modifier.height(12.dp))
                        if (tracks.isNotEmpty()) {
                            Button(
                                onClick = { onPlay(tracks.first(), tracks) },
                                shape = RoundedCornerShape(10.dp),
                                colors = ButtonDefaults.buttonColors(containerColor = Teal, contentColor = Color(0xFF04100F)),
                                contentPadding = PaddingValues(horizontal = 18.dp, vertical = 10.dp)
                            ) {
                                Icon(Icons.Rounded.PlayArrow, contentDescription = null, modifier = Modifier.size(18.dp))
                                Spacer(Modifier.width(5.dp))
                                Text("Слушать всё", fontSize = 12.5.sp, fontWeight = FontWeight.Bold)
                            }
                        }
                    }
                }

                if (albums.isNotEmpty()) {
                    item {
                        Text(
                            "Альбомы",
                            color = TextMain,
                            fontSize = 17.sp,
                            fontWeight = FontWeight.Bold,
                            modifier = Modifier.padding(start = 20.dp, top = 16.dp, bottom = 8.dp)
                        )
                    }
                    item {
                        LazyRow(
                            contentPadding = PaddingValues(horizontal = 20.dp),
                            horizontalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            items(albums, key = { it.url }) { album ->
                                ArtistAlbumCard(album = album, onClick = { onOpenAlbum(album) })
                            }
                        }
                    }
                }

                if (tracks.isNotEmpty()) {
                    item {
                        Text(
                            "Треки",
                            color = TextMain,
                            fontSize = 17.sp,
                            fontWeight = FontWeight.Bold,
                            modifier = Modifier.padding(start = 20.dp, top = 18.dp, bottom = 4.dp)
                        )
                    }
                    items(tracks, key = { it.key }) { track ->
                        TrackRow(
                            track = track,
                            liked = likedKeys.contains(track.key),
                            downloaded = downloads.containsKey(track.key),
                            downloading = downloading.contains(track.key),
                            active = activeKey == track.key,
                            onPlay = { onPlay(track, tracks) },
                            onLike = { onLike(track) },
                            onDownload = { onDownload(track) },
                            onAddToPlaylist = { onAddToPlaylist(track) }
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ArtistAlbumCard(album: AlbumRef, onClick: () -> Unit) {
    Column(Modifier.width(124.dp).clickable(onClick = onClick)) {
        AsyncImage(
            model = album.thumbnail,
            contentDescription = null,
            contentScale = ContentScale.Crop,
            modifier = Modifier.size(124.dp).clip(RoundedCornerShape(12.dp)).background(Surface2)
        )
        Spacer(Modifier.height(6.dp))
        Text(
            album.title,
            color = TextMain,
            fontSize = 11.5.sp,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
        Text(
            album.artist,
            color = Muted,
            fontSize = 10.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
    }
}

private fun artistTracksWord(n: Int): String {
    val mod100 = n % 100
    val mod10 = n % 10
    return when {
        mod100 in 11..14 -> "треков"
        mod10 == 1 -> "трек"
        mod10 in 2..4 -> "трека"
        else -> "треков"
    }
}

private fun artistAlbumsWord(n: Int): String {
    val mod100 = n % 100
    val mod10 = n % 10
    return when {
        mod100 in 11..14 -> "альбомов"
        mod10 == 1 -> "альбом"
        mod10 in 2..4 -> "альбома"
        else -> "альбомов"
    }
}
