package co.undertow.mobile

import androidx.compose.animation.core.animateDpAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.QueueMusic
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage

@Composable
internal fun LibraryScreen(
    likes: List<TrackItem>,
    albums: List<AlbumItem>,
    history: List<HistoryEntry>,
    playlists: List<PlaylistItem>,
    downloadedTracks: List<TrackItem>,
    downloads: Map<String, java.io.File>,
    downloading: Set<String>,
    likedKeys: Set<String>,
    activeKey: String?,
    onPlay: (TrackItem, List<TrackItem>) -> Unit,
    onLike: (TrackItem) -> Unit,
    onDownload: (TrackItem) -> Unit,
    onAddToPlaylist: (TrackItem) -> Unit,
    onOpenAlbum: (AlbumItem) -> Unit,
    onOpenPlaylist: (PlaylistItem) -> Unit,
    onOpenLikes: () -> Unit,
    onOpenPlaylists: () -> Unit,
    onOpenAlbums: () -> Unit,
    onOpenDownloads: () -> Unit,
    onOpenHistory: () -> Unit
) {
    val historyTracks = history.map { it.track }
    val savedTracks = downloadedTracks.filter { downloads.containsKey(it.key) }

    Box(Modifier.fillMaxSize()) {
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(bottom = 26.dp)
        ) {
            item {
                Column(Modifier.padding(start = 22.dp, end = 22.dp, top = 0.dp, bottom = 4.dp)) {
                    Text(
                        "Библиотека",
                        color = TextMain,
                        fontSize = 25.sp,
                        fontWeight = FontWeight.SemiBold,
                        letterSpacing = (-0.3).sp
                    )
                    Spacer(Modifier.height(2.dp))
                    Text(
                        "${likes.size} ${tracksWord(likes.size)} · ${albums.size} ${albumsWord(albums.size)} · ${history.size} в истории",
                        color = Muted,
                        fontSize = 12.sp
                    )
                }
            }

            item {
                ShelfHeader(
                    title = "Мне нравится",
                    subtitle = "${likes.size} ${tracksWord(likes.size)}",
                    action = if (likes.isEmpty()) null else "Все треки",
                    onAction = onOpenLikes
                )
            }
            item {
                if (likes.isEmpty()) {
                    EmptyShelf("Ставь сердечки на треках — они соберутся здесь.")
                } else {
                    TrackColumnsShelf(
                        tracks = likes,
                        activeKey = activeKey,
                        onPlay = onPlay
                    )
                }
            }

            item {
                ShelfHeader(
                    title = "Плейлисты",
                    subtitle = "${playlists.size} ${playlistsWord(playlists.size)}",
                    action = "Все плейлисты",
                    onAction = onOpenPlaylists
                )
            }
            item {
                if (playlists.isEmpty()) {
                    EmptyShelf("Открой «Все плейлисты» и создай первый.")
                } else {
                    LazyRow(
                        contentPadding = PaddingValues(start = 22.dp, end = 22.dp),
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        items(playlists.take(10), key = { it.id }) { playlist ->
                            PlaylistShelfCard(playlist = playlist, onClick = { onOpenPlaylist(playlist) })
                        }
                    }
                }
            }

            item {
                ShelfHeader(
                    title = "Альбомы",
                    subtitle = "${albums.size} ${albumsWord(albums.size)}",
                    action = "Все альбомы",
                    onAction = onOpenAlbums
                )
            }
            item {
                if (albums.isEmpty()) {
                    EmptyShelf("Сохранённые альбомы появятся здесь.")
                } else {
                    LazyRow(
                        contentPadding = PaddingValues(start = 22.dp, end = 22.dp),
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        items(albums.take(10), key = { it.url }) { album ->
                            AlbumShelfCard(album = album, onClick = { onOpenAlbum(album) })
                        }
                    }
                }
            }
            if (savedTracks.isNotEmpty()) {
                item {
                    ShelfHeader(
                        title = "Скачано",
                        subtitle = "${savedTracks.size} ${tracksWord(savedTracks.size)} · без сети",
                        action = "Все скачанные",
                        onAction = onOpenDownloads
                    )
                }
                item {
                    TrackColumnsShelf(
                        tracks = savedTracks,
                        activeKey = activeKey,
                        onPlay = onPlay
                    )
                }
            }

            item {
                ShelfHeader(
                    title = "История",
                    subtitle = "${history.size} ${tracksWord(history.size)}",
                    action = if (history.isEmpty()) null else "Вся история",
                    onAction = onOpenHistory
                )
            }
            item {
                if (history.isEmpty()) {
                    EmptyShelf("Здесь появятся треки, которые ты слушал.")
                } else {
                    TrackColumnsShelf(
                        tracks = historyTracks,
                        activeKey = activeKey,
                        onPlay = onPlay
                    )
                }
            }

        }
    }

}

@Composable
private fun ShelfHeader(
    title: String,
    subtitle: String,
    action: String? = null,
    actionColor: Color = Teal,
    onAction: (() -> Unit)? = null
) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(start = 22.dp, end = 14.dp, top = 24.dp, bottom = 10.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(Modifier.weight(1f)) {
            Text(
                title,
                color = TextMain,
                fontSize = 15.5.sp,
                fontWeight = FontWeight.SemiBold,
                letterSpacing = (-0.1).sp
            )
            Spacer(Modifier.height(1.dp))
            Text(subtitle, color = Muted, fontSize = 10.5.sp)
        }
        if (action != null && onAction != null) {
            Box(
                Modifier
                    .clip(RoundedCornerShape(7.dp))
                    .clickable(onClick = onAction)
                    .padding(horizontal = 8.dp, vertical = 6.dp)
            ) {
                Text(
                    action,
                    color = actionColor,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Medium
                )
            }
        }
    }
}

@Composable
private fun EmptyShelf(text: String) {
    Box(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 22.dp)
            .heightIn(min = 62.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(Surface.copy(alpha = 0.55f))
            .border(1.dp, Line, RoundedCornerShape(12.dp))
            .padding(horizontal = 14.dp, vertical = 12.dp),
        contentAlignment = Alignment.CenterStart
    ) {
        Text(text, color = Muted, fontSize = 11.5.sp, lineHeight = 16.sp)
    }
}

@Composable
private fun TrackColumnsShelf(
    tracks: List<TrackItem>,
    activeKey: String?,
    onPlay: (TrackItem, List<TrackItem>) -> Unit
) {
    val columns = tracks.take(12).chunked(3).take(4)
    if (columns.isEmpty()) return
    val pager = rememberPagerState(pageCount = { columns.size })
    val rowHeight = 72.dp
    val rows = columns[pager.currentPage].size.coerceAtLeast(1)
    val shelfHeight by animateDpAsState(rowHeight * rows, label = "trackShelfHeight")

    Column(Modifier.fillMaxWidth()) {
        HorizontalPager(state = pager, modifier = Modifier.height(shelfHeight)) { page ->
            Column(Modifier.fillMaxWidth().padding(horizontal = 22.dp)) {
                columns[page].forEach { track ->
                    CompactTrackRow(
                        track = track,
                        active = activeKey == track.key,
                        onClick = { onPlay(track, tracks) }
                    )
                }
            }
        }
    }
}

@Composable
private fun CompactTrackRow(track: TrackItem, active: Boolean, onClick: () -> Unit) {
    val shape = RoundedCornerShape(8.dp)
    Row(
        Modifier
            .fillMaxWidth()
            .height(72.dp)
            .clip(shape)
            .background(if (active) Teal.copy(alpha = 0.09f) else Color.Transparent)
            .clickable(onClick = onClick)
            .padding(horizontal = 6.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        AsyncImage(
            model = track.thumbnail,
            contentDescription = null,
            contentScale = ContentScale.Crop,
            modifier = Modifier
                .size(52.dp)
                .clip(RoundedCornerShape(9.dp))
                .background(Surface2)
                .border(1.dp, if (active) Teal.copy(alpha = 0.5f) else Line, RoundedCornerShape(9.dp))
        )
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(
                track.title,
                color = if (active) Teal else TextMain,
                fontSize = 14.5.sp,
                fontWeight = FontWeight.Medium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            Spacer(Modifier.height(2.dp))
            Text(
                track.artist,
                color = Muted,
                fontSize = 11.5.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
        Text(
            track.durationText,
            color = Muted,
            fontSize = 10.5.sp,
            modifier = Modifier.padding(end = 4.dp)
        )
    }
}

@Composable
private fun PlaylistShelfCard(playlist: PlaylistItem, onClick: () -> Unit) {
    val shape = RoundedCornerShape(12.dp)
    Column(
        Modifier
            .width(118.dp)
            .clip(shape)
            .clickable(onClick = onClick)
    ) {
        Box(
            Modifier
                .fillMaxWidth()
                .aspectRatio(1f)
                .clip(shape)
                .background(
                    Brush.linearGradient(
                        listOf(Teal.copy(alpha = 0.18f), Indigo.copy(alpha = 0.16f))
                    )
                )
                .border(1.dp, Line, shape)
        ) {
            if (playlist.coverUrl != null) {
                AsyncImage(
                    model = playlist.coverUrl,
                    contentDescription = null,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxSize()
                )
            } else {
                Icon(
                    Icons.Rounded.QueueMusic,
                    contentDescription = null,
                    tint = Color.White.copy(alpha = 0.28f),
                    modifier = Modifier.align(Alignment.Center).size(38.dp)
                )
            }
        }
        Spacer(Modifier.height(7.dp))
        Text(
            playlist.name,
            color = TextMain,
            fontSize = 12.5.sp,
            fontWeight = FontWeight.Medium,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
        Text(
            "${playlist.tracks.size} ${tracksWord(playlist.tracks.size)}",
            color = Muted,
            fontSize = 10.sp,
            maxLines = 1
        )
    }
}

@Composable
private fun AlbumShelfCard(album: AlbumItem, onClick: () -> Unit) {
    val shape = RoundedCornerShape(12.dp)
    Column(
        Modifier
            .width(118.dp)
            .clip(shape)
            .clickable(onClick = onClick)
    ) {
        Box(
            Modifier
                .fillMaxWidth()
                .aspectRatio(1f)
                .clip(shape)
                .background(Surface2)
                .border(1.dp, Line, shape)
        ) {
            AsyncImage(
                model = album.thumbnail,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize()
            )
            Box(
                Modifier
                    .align(Alignment.BottomEnd)
                    .padding(6.dp)
                    .size(25.dp)
                    .clip(CircleShape)
                    .background(Color(0xD9080C11)),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    Icons.Rounded.PlayArrow,
                    contentDescription = "Открыть альбом",
                    tint = Teal,
                    modifier = Modifier.size(16.dp)
                )
            }
        }
        Spacer(Modifier.height(7.dp))
        Text(
            album.title,
            color = TextMain,
            fontSize = 12.5.sp,
            fontWeight = FontWeight.Medium,
            maxLines = 2,
            lineHeight = 16.sp,
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

private fun tracksWord(n: Int): String {
    val mod100 = n % 100
    val mod10 = n % 10
    return when {
        mod100 in 11..14 -> "треков"
        mod10 == 1 -> "трек"
        mod10 in 2..4 -> "трека"
        else -> "треков"
    }
}

private fun albumsWord(n: Int): String {
    val mod100 = n % 100
    val mod10 = n % 10
    return when {
        mod100 in 11..14 -> "альбомов"
        mod10 == 1 -> "альбом"
        mod10 in 2..4 -> "альбома"
        else -> "альбомов"
    }
}

private fun playlistsWord(n: Int): String {
    val mod100 = n % 100
    val mod10 = n % 10
    return when {
        mod100 in 11..14 -> "плейлистов"
        mod10 == 1 -> "плейлист"
        mod10 in 2..4 -> "плейлиста"
        else -> "плейлистов"
    }
}
