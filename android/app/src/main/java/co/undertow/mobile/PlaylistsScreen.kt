package co.undertow.mobile

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.PlaylistPlay
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
fun PlaylistsScreen(
    playlists: List<PlaylistItem>,
    onOpen: (PlaylistItem) -> Unit,
    onCreate: (String) -> Unit
) {
    var showCreate by remember { mutableStateOf(false) }

    Column(Modifier.fillMaxSize()) {
        Row(
            Modifier.fillMaxWidth().padding(start = 20.dp, end = 10.dp, top = 2.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(Modifier.weight(1f)) {
                Text("Плейлисты", color = TextMain, fontSize = 20.sp, fontWeight = FontWeight.Bold)
                Text(
                    if (playlists.isEmpty()) "Собери свою подборку" else "${playlists.size} ${playlistsWord(playlists.size)}",
                    color = Muted,
                    fontSize = 10.5.sp
                )
            }
            IconButton(onClick = { showCreate = true }) {
                Icon(Icons.Rounded.Add, contentDescription = "Новый плейлист", tint = Teal, modifier = Modifier.size(23.dp))
            }
        }

        if (playlists.isEmpty()) {
            Column(Modifier.padding(horizontal = 24.dp, vertical = 34.dp)) {
                Text("Пока нет плейлистов", color = TextMain, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.height(6.dp))
                Text(
                    "Нажми + или добавь трек в плейлист из любой строки — и он появится здесь.",
                    color = Muted,
                    fontSize = 12.5.sp,
                    lineHeight = 18.sp
                )
            }
        } else {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 10.dp, bottom = 32.dp),
                verticalArrangement = Arrangement.spacedBy(9.dp)
            ) {
                items(playlists, key = { it.id }) { playlist ->
                    PlaylistRow(playlist = playlist, onOpen = { onOpen(playlist) })
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
internal fun PlaylistRow(playlist: PlaylistItem, onOpen: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(13.dp))
            .background(Surface)
            .clickable(onClick = onOpen)
            .padding(9.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            Modifier.size(56.dp).clip(RoundedCornerShape(10.dp)).background(
                Brush.linearGradient(listOf(Teal.copy(alpha = 0.25f), Indigo.copy(alpha = 0.2f)))
            ),
            contentAlignment = Alignment.Center
        ) {
            val cover = playlist.coverUrl ?: playlist.tracks.firstOrNull()?.thumbnail
            if (cover != null) {
                AsyncImage(
                    model = cover,
                    contentDescription = null,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxSize()
                )
            } else {
                Icon(Icons.Rounded.PlaylistPlay, contentDescription = null, tint = Teal, modifier = Modifier.size(24.dp))
            }
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(
                playlist.name,
                color = TextMain,
                fontSize = 14.sp,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            Text(
                "${playlist.tracks.size} ${playlistTracksWord(playlist.tracks.size)}",
                color = Muted,
                fontSize = 10.5.sp
            )
        }
        Text("Открыть", color = Teal, fontSize = 10.5.sp, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
fun CreatePlaylistDialog(onDismiss: () -> Unit, onCreate: (String) -> Unit) {
    var name by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Новый плейлист", color = TextMain, fontSize = 17.sp, fontWeight = FontWeight.Bold) },
        text = {
            OutlinedTextField(
                value = name,
                onValueChange = { name = it.take(80) },
                singleLine = true,
                placeholder = { Text("Название", color = Muted) },
                modifier = Modifier.fillMaxWidth()
            )
        },
        confirmButton = {
            TextButton(
                onClick = { onCreate(name.trim()) },
                enabled = name.isNotBlank()
            ) { Text("Создать", color = if (name.isNotBlank()) Teal else Muted) }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Отмена", color = Muted) }
        },
        containerColor = Surface2
    )
}

@Composable
fun AddToPlaylistDialog(
    track: TrackItem,
    playlists: List<PlaylistItem>,
    onDismiss: () -> Unit,
    onPick: (PlaylistItem) -> Unit,
    onCreate: (String) -> Unit
) {
    var name by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Добавить в плейлист", color = TextMain, fontSize = 17.sp, fontWeight = FontWeight.Bold) },
        text = {
            Column {
                Text(track.title, color = Muted, fontSize = 11.5.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                if (playlists.isNotEmpty()) {
                    Spacer(Modifier.height(8.dp))
                    LazyColumn(modifier = Modifier.heightIn(max = 220.dp)) {
                        items(playlists, key = { it.id }) { playlist ->
                            Row(
                                Modifier.fillMaxWidth()
                                    .clip(RoundedCornerShape(9.dp))
                                    .clickable { onPick(playlist) }
                                    .padding(horizontal = 8.dp, vertical = 10.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Icon(Icons.Rounded.PlaylistPlay, contentDescription = null, tint = Teal, modifier = Modifier.size(18.dp))
                                Spacer(Modifier.width(9.dp))
                                Column(Modifier.weight(1f)) {
                                    Text(playlist.name, color = TextMain, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    Text("${playlist.tracks.size} ${playlistTracksWord(playlist.tracks.size)}", color = Muted, fontSize = 10.sp)
                                }
                            }
                        }
                    }
                }
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it.take(80) },
                    singleLine = true,
                    placeholder = { Text("Новый плейлист", color = Muted) },
                    modifier = Modifier.fillMaxWidth()
                )
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    TextButton(
                        onClick = { onCreate(name.trim()) },
                        enabled = name.isNotBlank()
                    ) { Text("Создать и добавить", color = if (name.isNotBlank()) Teal else Muted, fontSize = 12.sp) }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) { Text("Закрыть", color = Muted) }
        },
        containerColor = Surface2
    )
}

internal fun playlistTracksWord(n: Int): String {
    val mod100 = n % 100
    val mod10 = n % 10
    return when {
        mod100 in 11..14 -> "треков"
        mod10 == 1 -> "трек"
        mod10 in 2..4 -> "трека"
        else -> "треков"
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
