package co.undertow.mobile

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ArrowBack
import androidx.compose.material.icons.rounded.MoreVert
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage

@Composable
fun PlaylistScreen(
    playlist: PlaylistItem,
    downloads: Map<String, java.io.File>,
    downloading: Set<String>,
    likedKeys: Set<String>,
    activeKey: String?,
    onBack: () -> Unit,
    onPlay: (TrackItem, List<TrackItem>) -> Unit,
    onLike: (TrackItem) -> Unit,
    onDownload: (TrackItem) -> Unit,
    onRemoveTrack: (TrackItem) -> Unit,
    onRename: (String) -> Unit,
    onCoverChange: (String?) -> Unit,
    onDelete: () -> Unit
) {
    var confirmDelete by remember { mutableStateOf(false) }
    var showRename by remember { mutableStateOf(false) }
    var showCovers by remember { mutableStateOf(false) }
    var menuOpen by remember { mutableStateOf(false) }
    val cover = playlist.coverUrl ?: playlist.tracks.firstOrNull()?.thumbnail

    Column(Modifier.fillMaxSize()) {
        Row(
            Modifier.fillMaxWidth().padding(start = 8.dp, end = 4.dp, top = 2.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            IconButton(onClick = onBack) {
                Icon(Icons.Rounded.ArrowBack, contentDescription = "Назад", tint = TextMain)
            }
            Text("Плейлист", color = TextMain, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.weight(1f))
            Box {
                IconButton(onClick = { menuOpen = true }) {
                    Icon(Icons.Rounded.MoreVert, contentDescription = "Ещё", tint = Muted, modifier = Modifier.size(20.dp))
                }
                DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }, containerColor = Surface2) {
                    DropdownMenuItem(
                        text = { Text("Переименовать", color = TextMain, fontSize = 13.sp) },
                        onClick = { menuOpen = false; showRename = true }
                    )
                    DropdownMenuItem(
                        text = { Text("Сменить обложку", color = TextMain, fontSize = 13.sp) },
                        enabled = playlist.tracks.isNotEmpty(),
                        onClick = { menuOpen = false; showCovers = true }
                    )
                    DropdownMenuItem(
                        text = { Text("Удалить плейлист", color = Color(0xFFFF8A8A), fontSize = 13.sp) },
                        onClick = { menuOpen = false; confirmDelete = true }
                    )
                }
            }
        }

        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(bottom = 32.dp)
        ) {
            item {
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Box(Modifier.size(86.dp).clip(RoundedCornerShape(13.dp)).background(Surface2)) {
                        if (cover != null) {
                            AsyncImage(
                                model = cover,
                                contentDescription = null,
                                contentScale = ContentScale.Crop,
                                modifier = Modifier.fillMaxSize()
                            )
                        }
                    }
                    Spacer(Modifier.width(14.dp))
                    Column(Modifier.weight(1f)) {
                        Text(
                            playlist.name,
                            color = TextMain,
                            fontSize = 20.sp,
                            fontWeight = FontWeight.Bold,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis
                        )
                        Text(
                            "${playlist.tracks.size} ${playlistTracksWord(playlist.tracks.size)}",
                            color = Muted,
                            fontSize = 11.sp
                        )
                    }
                }

                if (playlist.tracks.isNotEmpty()) {
                    Button(
                        onClick = { onPlay(playlist.tracks.first(), playlist.tracks) },
                        shape = RoundedCornerShape(10.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = Teal, contentColor = Color(0xFF04100F)),
                        contentPadding = PaddingValues(horizontal = 18.dp, vertical = 10.dp),
                        modifier = Modifier.padding(start = 18.dp, top = 2.dp, bottom = 10.dp)
                    ) {
                        Icon(Icons.Rounded.PlayArrow, contentDescription = null, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(5.dp))
                        Text("Слушать всё", fontSize = 12.5.sp, fontWeight = FontWeight.Bold)
                    }
                }
            }

            if (playlist.tracks.isEmpty()) {
                item {
                    Column(Modifier.padding(horizontal = 24.dp, vertical = 24.dp)) {
                        Text("Плейлист пуст", color = TextMain, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                        Spacer(Modifier.height(6.dp))
                        Text("Добавляй треки кнопкой «В плейлист» в списках и поиске.", color = Muted, fontSize = 12.sp)
                    }
                }
            } else {
                items(playlist.tracks, key = { it.key }) { track ->
                    TrackRow(
                        track = track,
                        liked = likedKeys.contains(track.key),
                        downloaded = downloads.containsKey(track.key),
                        downloading = downloading.contains(track.key),
                        active = activeKey == track.key,
                        onPlay = { onPlay(track, playlist.tracks) },
                        onLike = { onLike(track) },
                        onDownload = { onDownload(track) },
                        onRemoveFromPlaylist = { onRemoveTrack(track) }
                    )
                }
            }
        }
    }

    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text("Удалить плейлист?", color = TextMain, fontSize = 17.sp, fontWeight = FontWeight.Bold) },
            text = { Text("«${playlist.name}» исчезнет из библиотеки. Треки останутся на месте.", color = Muted, fontSize = 12.5.sp) },
            confirmButton = {
                TextButton(onClick = { confirmDelete = false; onDelete() }) {
                    Text("Удалить", color = Color(0xFFFF8A8A))
                }
            },
            dismissButton = {
                TextButton(onClick = { confirmDelete = false }) { Text("Отмена", color = Muted) }
            },
            containerColor = Surface2
        )
    }

    if (showRename) {
        RenamePlaylistDialog(
            current = playlist.name,
            onDismiss = { showRename = false },
            onSave = { name -> showRename = false; onRename(name) }
        )
    }

    if (showCovers) {
        CoverPickerDialog(
            playlist = playlist,
            onDismiss = { showCovers = false },
            onPick = { url -> showCovers = false; onCoverChange(url) }
        )
    }
}

@Composable
private fun RenamePlaylistDialog(current: String, onDismiss: () -> Unit, onSave: (String) -> Unit) {
    var name by remember { mutableStateOf(current) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Переименовать плейлист", color = TextMain, fontSize = 17.sp, fontWeight = FontWeight.Bold) },
        text = {
            OutlinedTextField(
                value = name,
                onValueChange = { name = it.take(80) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )
        },
        confirmButton = {
            TextButton(onClick = { onSave(name.trim()) }, enabled = name.isNotBlank()) {
                Text("Сохранить", color = if (name.isNotBlank()) Teal else Muted)
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Отмена", color = Muted) } },
        containerColor = Surface2
    )
}

@Composable
private fun CoverPickerDialog(playlist: PlaylistItem, onDismiss: () -> Unit, onPick: (String?) -> Unit) {
    val covers = playlist.tracks.mapNotNull { it.thumbnail }.distinct()
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Обложка плейлиста", color = TextMain, fontSize = 17.sp, fontWeight = FontWeight.Bold) },
        text = {
            Column {
                TextButton(onClick = { onPick(null) }) {
                    Text("Авто — первый трек", color = Teal, fontSize = 12.sp)
                }
                LazyVerticalGrid(
                    columns = GridCells.Fixed(3),
                    modifier = Modifier.heightIn(max = 340.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    items(covers) { url ->
                        Box(
                            Modifier
                                .fillMaxWidth()
                                .aspectRatio(1f)
                                .clip(RoundedCornerShape(9.dp))
                                .background(Surface)
                                .clickable { onPick(url) }
                        ) {
                            AsyncImage(
                                model = url,
                                contentDescription = null,
                                contentScale = ContentScale.Crop,
                                modifier = Modifier.fillMaxSize()
                            )
                        }
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Закрыть", color = Muted) } },
        containerColor = Surface2
    )
}
