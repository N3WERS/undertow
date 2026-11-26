package co.undertow.mobile

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.KeyboardArrowDown
import androidx.compose.material.icons.rounded.KeyboardArrowUp
import androidx.compose.material.icons.rounded.Repeat
import androidx.compose.material.icons.rounded.RepeatOne
import androidx.compose.material.icons.rounded.Shuffle
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
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
fun QueueScreen(
    queue: List<TrackItem>,
    currentIndex: Int,
    playing: Boolean,
    shuffle: Boolean,
    repeatMode: Int,
    onBack: () -> Unit,
    onPlayAt: (Int) -> Unit,
    onRemove: (Int) -> Unit,
    onMove: (Int, Int) -> Unit,
    onToggleShuffle: () -> Unit,
    onCycleRepeat: () -> Unit
) {
    Column(Modifier.fillMaxSize()) {
        Row(
            Modifier.fillMaxWidth().padding(start = 8.dp, end = 18.dp, top = 2.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            IconButton(onClick = onBack) {
                Icon(Icons.Rounded.ArrowBack, contentDescription = "Назад", tint = TextMain)
            }
            Column(Modifier.weight(1f)) {
                Text("Очередь", color = TextMain, fontSize = 18.sp, fontWeight = FontWeight.Bold)
                Text(
                    if (queue.isEmpty()) "Пусто" else "${queue.size} ${playlistTracksWord(queue.size)}",
                    color = Muted,
                    fontSize = 10.5.sp
                )
            }
            QueueModeButton(
                icon = Icons.Rounded.Shuffle,
                description = if (shuffle) "Перемешивание включено" else "Перемешать очередь",
                active = shuffle,
                onClick = onToggleShuffle
            )
            Spacer(Modifier.width(6.dp))
            QueueModeButton(
                icon = if (repeatMode == 2) Icons.Rounded.RepeatOne else Icons.Rounded.Repeat,
                description = when (repeatMode) {
                    2 -> "Повтор трека"
                    1 -> "Повтор очереди"
                    else -> "Повтор выключен"
                },
                active = repeatMode > 0,
                onClick = onCycleRepeat
            )
        }

        if (queue.isEmpty()) {
            Column(Modifier.padding(24.dp)) {
                Text("Очередь пуста", color = TextMain, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.height(6.dp))
                Text("Запусти трек или альбом — очередь появится здесь.", color = Muted, fontSize = 12.5.sp)
            }
            return
        }

        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(start = 8.dp, end = 8.dp, bottom = 28.dp)
        ) {
            itemsIndexed(queue) { index, track ->
                val current = index == currentIndex
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(11.dp))
                        .background(if (current) Teal.copy(alpha = 0.12f) else Color.Transparent)
                        .clickable { onPlayAt(index) }
                        .padding(start = 8.dp, end = 2.dp, top = 6.dp, bottom = 6.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Box(Modifier.size(38.dp)) {
                        AsyncImage(
                            model = track.thumbnail,
                            contentDescription = null,
                            contentScale = ContentScale.Crop,
                            modifier = Modifier.fillMaxSize().clip(RoundedCornerShape(8.dp)).background(
                                Brush.linearGradient(listOf(Teal.copy(alpha = 0.2f), Indigo.copy(alpha = 0.16f)))
                            )
                        )
                    }
                    Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f)) {
                        Text(
                            track.title,
                            color = if (current) Teal else TextMain,
                            fontSize = 13.sp,
                            fontWeight = if (current) FontWeight.SemiBold else FontWeight.Medium,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                        Text(
                            if (current) {
                                if (playing) "Сейчас играет" else "Пауза"
                            } else track.artist,
                            color = Muted,
                            fontSize = 10.sp,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                    }
                    IconButton(
                        onClick = { onMove(index, index - 1) },
                        enabled = index > 0,
                        modifier = Modifier.size(29.dp)
                    ) {
                        Icon(
                            Icons.Rounded.KeyboardArrowUp,
                            contentDescription = "Выше",
                            tint = if (index > 0) Muted else Muted.copy(alpha = 0.25f),
                            modifier = Modifier.size(19.dp)
                        )
                    }
                    IconButton(
                        onClick = { onMove(index, index + 1) },
                        enabled = index < queue.lastIndex,
                        modifier = Modifier.size(29.dp)
                    ) {
                        Icon(
                            Icons.Rounded.KeyboardArrowDown,
                            contentDescription = "Ниже",
                            tint = if (index < queue.lastIndex) Muted else Muted.copy(alpha = 0.25f),
                            modifier = Modifier.size(19.dp)
                        )
                    }
                    IconButton(onClick = { onRemove(index) }, modifier = Modifier.size(30.dp)) {
                        Icon(Icons.Rounded.Close, contentDescription = "Убрать из очереди", tint = Muted, modifier = Modifier.size(16.dp))
                    }
                }
            }
        }
    }
}

@Composable
private fun QueueModeButton(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    description: String,
    active: Boolean,
    onClick: () -> Unit
) {
    Box(
        Modifier
            .size(36.dp)
            .clip(RoundedCornerShape(11.dp))
            .background(if (active) Teal.copy(alpha = 0.12f) else Color.Transparent)
            .border(
                1.dp,
                if (active) Teal.copy(alpha = 0.24f) else Line,
                RoundedCornerShape(11.dp)
            )
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center
    ) {
        Icon(
            icon,
            contentDescription = description,
            tint = if (active) Teal else Muted,
            modifier = Modifier.size(19.dp)
        )
    }
}
