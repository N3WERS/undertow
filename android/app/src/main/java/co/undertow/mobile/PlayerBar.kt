package co.undertow.mobile

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.Favorite
import androidx.compose.material.icons.rounded.FavoriteBorder
import androidx.compose.material.icons.rounded.Pause
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage

private val PlayerBg = Color(0xF20A0F15)
private val PlayerLine = Color(0xFF2A3644)
private val PlayerGlow = Color(0xFFF2F6FA)

/** Полоса прогресса: тап и перетаскивание работают и в мини-плеере, и на полном экране. */
@Composable
internal fun TrackSeekBar(
    progress: Float,
    duration: Long,
    onSeek: (Long) -> Unit,
    modifier: Modifier = Modifier,
    touchHeight: Dp = 12.dp,
    trackHeight: Dp = 2.dp,
    trackAtTop: Boolean = true
) {
    Box(
        modifier
            .fillMaxWidth()
            .height(touchHeight)
            .pointerInput(duration) {
                awaitEachGesture {
                    val down = awaitFirstDown(requireUnconsumed = false)
                    fun seek(x: Float) {
                        if (duration > 0 && size.width > 0) {
                            onSeek((x / size.width * duration).toLong().coerceIn(0L, duration))
                        }
                    }
                    seek(down.position.x)
                    down.consume()
                    while (true) {
                        val event = awaitPointerEvent()
                        val change = event.changes.firstOrNull() ?: break
                        if (!change.pressed) break
                        seek(change.position.x)
                        change.consume()
                    }
                }
            }
    ) {
        Box(
            Modifier
                .fillMaxWidth()
                .height(trackHeight)
                .align(if (trackAtTop) Alignment.TopStart else Alignment.CenterStart)
        ) {
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(trackHeight)
                    .background(Color.White.copy(alpha = 0.13f))
            )
            Box(
                Modifier
                    .fillMaxWidth(progress.coerceIn(0f, 1f))
                    .height(trackHeight)
                    .background(
                        Brush.horizontalGradient(
                            listOf(Teal, Color(0xFF6EA7FF), Color(0xFF9A8CFF))
                        )
                    )
            )
        }
    }
}

@Composable
fun PlayerBar(
    track: TrackItem,
    playing: Boolean,
    resolving: Boolean,
    liked: Boolean,
    downloaded: Boolean,
    downloading: Boolean,
    position: Long,
    duration: Long,
    onToggle: () -> Unit,
    onLike: () -> Unit,
    onDownload: () -> Unit,
    onOpen: () -> Unit,
    onSeek: (Long) -> Unit
) {
    val progress = if (duration > 0) position.toFloat() / duration else 0f

    Column(
        Modifier
            .fillMaxWidth()
            .background(PlayerBg)
            .drawBehind {
                drawLine(
                    color = PlayerLine,
                    start = Offset.Zero,
                    end = Offset(size.width, 0f),
                    strokeWidth = 1.dp.toPx()
                )
            }
    ) {
        TrackSeekBar(
            progress = progress,
            duration = duration,
            onSeek = onSeek,
            touchHeight = 10.dp,
            trackHeight = 2.dp,
            trackAtTop = true
        )

        Row(
            Modifier
                .fillMaxWidth()
                .clickable(onClickLabel = "Открыть плеер", onClick = onOpen)
                .padding(start = 12.dp, end = 8.dp, top = 4.dp, bottom = 6.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            AsyncImage(
                model = track.thumbnail,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier
                    .size(42.dp)
                    .clip(RoundedCornerShape(9.dp))
                    .background(Surface2)
                    .border(1.dp, PlayerLine, RoundedCornerShape(9.dp))
            )
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    track.title,
                    color = if (resolving) Muted else TextMain,
                    fontSize = 13.5.sp,
                    fontWeight = FontWeight.Medium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Spacer(Modifier.height(1.dp))
                Text(
                    if (resolving) "Подключаю звук…" else track.artist,
                    color = Muted,
                    fontSize = 11.5.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
            IconButton(onClick = onLike, modifier = Modifier.size(34.dp)) {
                Icon(
                    if (liked) Icons.Rounded.Favorite else Icons.Rounded.FavoriteBorder,
                    contentDescription = if (liked) "Убрать лайк" else "Мне нравится",
                    tint = if (liked) Color(0xFFF2547D) else Muted,
                    modifier = Modifier.size(19.dp)
                )
            }
            IconButton(
                onClick = onDownload,
                enabled = !downloading,
                modifier = Modifier.size(34.dp)
            ) {
                when {
                    downloading -> CircularProgressIndicator(
                        modifier = Modifier.size(15.dp),
                        color = Teal,
                        strokeWidth = 1.7.dp
                    )
                    downloaded -> Icon(
                        Icons.Rounded.Check,
                        contentDescription = "Скачано",
                        tint = Teal,
                        modifier = Modifier.size(18.dp)
                    )
                    else -> Icon(
                        Icons.Rounded.Download,
                        contentDescription = "Скачать",
                        tint = Muted,
                        modifier = Modifier.size(18.dp)
                    )
                }
            }
            Spacer(Modifier.width(8.dp))
            Box(
                Modifier
                    .size(40.dp)
                    .shadow(5.dp, CircleShape)
                    .clip(CircleShape)
                    .background(PlayerGlow)
                    .clickable(enabled = !resolving, onClick = onToggle),
                contentAlignment = Alignment.Center
            ) {
                if (resolving) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(17.dp),
                        color = Color(0xFF080B10),
                        strokeWidth = 2.dp
                    )
                } else {
                    Icon(
                        if (playing) Icons.Rounded.Pause else Icons.Rounded.PlayArrow,
                        contentDescription = if (playing) "Пауза" else "Играть",
                        tint = Color(0xFF080B10),
                        modifier = Modifier.size(21.dp)
                    )
                }
            }
        }
    }
}
