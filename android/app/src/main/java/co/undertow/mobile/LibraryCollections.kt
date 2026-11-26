package co.undertow.mobile

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.ArrowBack
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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage

@Composable
internal fun AllPlaylistsScreen(
    playlists: List<PlaylistItem>,
    onBack: () -> Unit,
    onOpen: (PlaylistItem) -> Unit,
    onCreate: (String) -> Unit
) {
    var showCreate by remember { mutableStateOf(false) }

    Column(Modifier.fillMaxSize()) {
        CollectionHeader(
            title = "Плейлисты",
            subtitle = "${playlists.size} ${playlistsWord(playlists.size)}",
            onBack = onBack,
            onAdd = { showCreate = true }
        )

        if (playlists.isEmpty()) {
            CollectionEmpty(
                "Пока нет плейлистов",
                "Создай первый плейлист и добавляй треки из любой строки."
            )
        } else {
            LazyVerticalGrid(
                columns = GridCells.Fixed(2),
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(start = 18.dp, end = 18.dp, top = 4.dp, bottom = 24.dp),
                horizontalArrangement = Arrangement.spacedBy(16.dp),
                verticalArrangement = Arrangement.spacedBy(18.dp)
            ) {
                items(playlists, key = { it.id }) { playlist ->
                    PlaylistGridCard(playlist = playlist, onClick = { onOpen(playlist) })
                }
            }
        }
    }

    if (showCreate) {
        CreatePlaylistDialog(
            onDismiss = { showCreate = false },
            onCreate = { name ->
                showCreate = false
                onCreate(name)
            }
        )
    }
}

@Composable
internal fun AllAlbumsScreen(
    albums: List<AlbumItem>,
    onBack: () -> Unit,
    onOpen: (AlbumItem) -> Unit
) {
    Column(Modifier.fillMaxSize()) {
        CollectionHeader(
            title = "Альбомы",
            subtitle = "${albums.size} ${albumsWord(albums.size)}",
            onBack = onBack
        )

        if (albums.isEmpty()) {
            CollectionEmpty(
                "Пока нет альбомов",
                "Открой альбом в поиске и нажми «Сохранить»."
            )
        } else {
            LazyVerticalGrid(
                columns = GridCells.Fixed(2),
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(start = 18.dp, end = 18.dp, top = 4.dp, bottom = 24.dp),
                horizontalArrangement = Arrangement.spacedBy(16.dp),
                verticalArrangement = Arrangement.spacedBy(18.dp)
            ) {
                items(albums, key = { it.url }) { album ->
                    AlbumGridCard(album = album, onClick = { onOpen(album) })
                }
            }
        }
    }
}

@Composable
private fun CollectionHeader(
    title: String,
    subtitle: String,
    onBack: () -> Unit,
    onAdd: (() -> Unit)? = null
) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(start = 16.dp, end = 14.dp, top = 2.dp, bottom = 10.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            Modifier
                .size(38.dp)
                .clip(RoundedCornerShape(11.dp))
                .background(Color.White.copy(alpha = 0.045f))
                .border(1.dp, Line, RoundedCornerShape(11.dp))
                .clickable(onClick = onBack),
            contentAlignment = Alignment.Center
        ) {
            Icon(
                Icons.Rounded.ArrowBack,
                contentDescription = "Назад",
                tint = TextDim,
                modifier = Modifier.size(19.dp)
            )
        }
        Spacer(Modifier.width(11.dp))
        Column(Modifier.weight(1f)) {
            Text(
                title,
                color = TextMain,
                fontSize = 22.sp,
                fontWeight = FontWeight.SemiBold,
                letterSpacing = (-0.2).sp
            )
            Text(subtitle, color = Muted, fontSize = 11.sp)
        }
        if (onAdd != null) {
            Box(
                Modifier
                    .size(38.dp)
                    .clip(RoundedCornerShape(11.dp))
                    .background(Teal.copy(alpha = 0.10f))
                    .border(1.dp, Teal.copy(alpha = 0.22f), RoundedCornerShape(11.dp))
                    .clickable(onClick = onAdd),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    Icons.Rounded.Add,
                    contentDescription = "Новый плейлист",
                    tint = Teal,
                    modifier = Modifier.size(21.dp)
                )
            }
        }
    }
}

@Composable
private fun PlaylistGridCard(playlist: PlaylistItem, onClick: () -> Unit) {
    val shape = RoundedCornerShape(12.dp)
    Column(Modifier.fillMaxWidth().clickable(onClick = onClick)) {
        Box(
            Modifier
                .fillMaxWidth()
                .aspectRatio(1f)
                .clip(shape)
                .background(Brush.linearGradient(listOf(Teal.copy(alpha = 0.18f), Indigo.copy(alpha = 0.16f))))
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
            fontSize = 12.8.sp,
            fontWeight = FontWeight.Medium,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
        Text(
            "${playlist.tracks.size} ${playlistTracksWord(playlist.tracks.size)}",
            color = Muted,
            fontSize = 10.5.sp,
            maxLines = 1
        )
    }
}

@Composable
private fun AlbumGridCard(album: AlbumItem, onClick: () -> Unit) {
    val shape = RoundedCornerShape(12.dp)
    Column(Modifier.fillMaxWidth().clickable(onClick = onClick)) {
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
                    .size(26.dp)
                    .clip(CircleShape)
                    .background(Color(0xD9080C11)),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    Icons.Rounded.PlayArrow,
                    contentDescription = "Открыть альбом",
                    tint = Teal,
                    modifier = Modifier.size(17.dp)
                )
            }
        }
        Spacer(Modifier.height(7.dp))
        Text(
            album.title,
            color = TextMain,
            fontSize = 12.8.sp,
            fontWeight = FontWeight.Medium,
            maxLines = 2,
            lineHeight = 16.sp,
            overflow = TextOverflow.Ellipsis
        )
        Text(
            album.artist,
            color = Muted,
            fontSize = 10.5.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
    }
}

@Composable
private fun CollectionEmpty(title: String, text: String) {
    Column(
        Modifier.fillMaxSize().padding(horizontal = 28.dp, vertical = 54.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text(
            title,
            color = TextDim,
            fontSize = 14.sp,
            fontWeight = FontWeight.Medium,
            textAlign = TextAlign.Center
        )
        Spacer(Modifier.height(5.dp))
        Text(
            text,
            color = Muted,
            fontSize = 12.5.sp,
            lineHeight = 18.sp,
            textAlign = TextAlign.Center
        )
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
