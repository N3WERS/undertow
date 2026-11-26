package co.undertow.mobile

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.Favorite
import androidx.compose.material.icons.rounded.FavoriteBorder
import androidx.compose.material.icons.rounded.Pause
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.PlaylistAdd
import androidx.compose.material.icons.rounded.QueueMusic
import androidx.compose.material.icons.rounded.Repeat
import androidx.compose.material.icons.rounded.RepeatOne
import androidx.compose.material.icons.rounded.Shuffle
import androidx.compose.material.icons.rounded.SkipNext
import androidx.compose.material.icons.rounded.SkipPrevious
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.Velocity
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

private val Ink = Color(0xFF05090D)
private val Mint = Color(0xFFDFFFFC)

@Composable
fun NowPlayingScreen(
    track: TrackItem,
    playing: Boolean,
    resolving: Boolean,
    liked: Boolean,
    downloaded: Boolean,
    downloading: Boolean,
    position: Long,
    duration: Long,
    quality: String?,
    repeatMode: Int,
    shuffle: Boolean,
    onClose: () -> Unit,
    onToggle: () -> Unit,
    onPrev: () -> Unit,
    onNext: () -> Unit,
    onSeek: (Long) -> Unit,
    onLike: () -> Unit,
    onDownload: () -> Unit,
    onAddToPlaylist: () -> Unit,
    onOpenQueue: () -> Unit,
    onToggleShuffle: () -> Unit,
    onCycleRepeat: () -> Unit
) {
    val progress = if (duration > 0) position.toFloat() / duration else 0f

    BoxWithConstraints(Modifier.fillMaxSize()) {
        val screenHeight = constraints.maxHeight.toFloat()
        val threshold = with(LocalDensity.current) { 110.dp.toPx() }
        val offsetY = remember { Animatable(0f) }
        val scrollState = rememberScrollState()
        val scope = rememberCoroutineScope()
        val connection = remember(screenHeight, threshold, onClose) {
            object : NestedScrollConnection {
                override fun onPreScroll(available: Offset, source: NestedScrollSource): Offset {
                    if (source == NestedScrollSource.UserInput && available.y < 0f && offsetY.value > 0f) {
                        val next = (offsetY.value + available.y).coerceAtLeast(0f)
                        scope.launch { offsetY.snapTo(next) }
                        return Offset(0f, available.y)
                    }
                    return Offset.Zero
                }

                override fun onPostScroll(
                    consumed: Offset,
                    available: Offset,
                    source: NestedScrollSource
                ): Offset {
                    if (source == NestedScrollSource.UserInput && available.y > 0f && scrollState.value == 0) {
                        scope.launch { offsetY.snapTo(offsetY.value + available.y) }
                        return Offset(0f, available.y)
                    }
                    return Offset.Zero
                }

                override suspend fun onPostFling(consumed: Velocity, available: Velocity): Velocity {
                    if (offsetY.value > 0f) {
                        if (offsetY.value > threshold || available.y > 900f) {
                            offsetY.animateTo(screenHeight, tween(180))
                            onClose()
                        } else {
                            offsetY.animateTo(0f, spring())
                        }
                    }
                    return Velocity.Zero
                }
            }
        }

        Box(
            Modifier
                .fillMaxSize()
                .offset { IntOffset(0, offsetY.value.roundToInt()) }
                .background(Ink)
        ) {
            AsyncImage(
                model = track.thumbnail,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize().blur(58.dp).alpha(0.30f)
            )
            Box(
                Modifier.fillMaxSize().background(
                    Brush.verticalGradient(
                        listOf(
                            Color(0xB305090D),
                            Color(0xE605090D),
                            Color(0xFF05090D)
                        )
                    )
                )
            )

            Column(Modifier.fillMaxSize()) {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .padding(start = 22.dp, end = 22.dp, top = 8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Box(Modifier.size(6.dp).clip(CircleShape).background(Teal))
                    Spacer(Modifier.width(9.dp))
                    Text(
                        "СЕЙЧАС ИГРАЕТ",
                        color = Muted,
                        fontSize = 10.sp,
                        fontWeight = FontWeight.Medium,
                        letterSpacing = 1.8.sp
                    )
                    Spacer(Modifier.weight(1f))
                    Box(
                        Modifier
                            .size(38.dp)
                            .clip(RoundedCornerShape(12.dp))
                            .background(Color.White.copy(alpha = 0.045f))
                            .border(1.dp, Color.White.copy(alpha = 0.08f), RoundedCornerShape(12.dp))
                            .clickable(onClick = onClose),
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            Icons.Rounded.Close,
                            contentDescription = "Закрыть плеер",
                            tint = TextDim,
                            modifier = Modifier.size(18.dp)
                        )
                    }
                }

                Column(
                    Modifier
                        .weight(1f)
                        .fillMaxWidth()
                        .nestedScroll(connection)
                        .verticalScroll(scrollState)
                        .padding(horizontal = 22.dp)
                ) {
                    Spacer(Modifier.height(12.dp))
                    val coverShape = RoundedCornerShape(20.dp)
                    AsyncImage(
                        model = track.thumbnail,
                        contentDescription = null,
                        contentScale = ContentScale.Crop,
                        modifier = Modifier
                            .widthIn(max = 320.dp)
                            .fillMaxWidth()
                            .align(Alignment.CenterHorizontally)
                            .aspectRatio(1f)
                            .shadow(22.dp, coverShape)
                            .clip(coverShape)
                            .background(Surface2)
                            .border(1.dp, Color.White.copy(alpha = 0.14f), coverShape)
                    )

                    Spacer(Modifier.height(20.dp))
                    Text(
                        track.title,
                        color = Color(0xFFF3F8FE),
                        fontSize = 25.sp,
                        fontWeight = FontWeight.SemiBold,
                        lineHeight = 29.sp,
                        letterSpacing = (-0.4).sp,
                        maxLines = 3,
                        overflow = TextOverflow.Ellipsis
                    )
                    Spacer(Modifier.height(5.dp))
                    Text(
                        track.artist,
                        color = TextDim,
                        fontSize = 14.sp,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis
                    )

                    if (quality != null || downloaded || downloading) {
                        Spacer(Modifier.height(9.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                            if (quality != null) MetaPill(quality)
                            if (downloading) MetaPill("сохраняю…", Teal)
                            else if (downloaded) MetaPill("сохранено", Teal)
                        }
                    }

                    Spacer(Modifier.height(20.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(fmtMs(position), color = Muted, fontSize = 10.5.sp)
                        Spacer(Modifier.width(10.dp))
                        TrackSeekBar(
                            progress = progress,
                            duration = duration,
                            onSeek = onSeek,
                            modifier = Modifier.weight(1f),
                            touchHeight = 22.dp,
                            trackHeight = 4.dp,
                            trackAtTop = false
                        )
                        Spacer(Modifier.width(10.dp))
                        Text(fmtMs(duration), color = Muted, fontSize = 10.5.sp)
                    }

                    Spacer(Modifier.height(18.dp))
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        RoundAction(
                            icon = when {
                                downloading -> Icons.Rounded.Download
                                downloaded -> Icons.Rounded.Check
                                else -> Icons.Rounded.Download
                            },
                            description = if (downloaded) "Удалить скачивание" else "Скачать трек",
                            size = 48,
                            iconSize = 21,
                            active = downloaded,
                            busy = downloading,
                            onClick = onDownload
                        )
                        StepButton(Icons.Rounded.SkipPrevious, "Предыдущий", onPrev)
                        Box(
                            Modifier
                                .size(72.dp)
                                .shadow(18.dp, CircleShape)
                                .clip(CircleShape)
                                .background(
                                    Brush.verticalGradient(
                                        listOf(Color(0xFFF7FDFF), Color(0xFFCFE8FF))
                                    )
                                )
                                .clickable(enabled = !resolving, onClick = onToggle),
                            contentAlignment = Alignment.Center
                        ) {
                            if (resolving) {
                                CircularProgressIndicator(
                                    modifier = Modifier.size(26.dp),
                                    color = Color(0xFF071018),
                                    strokeWidth = 2.4.dp
                                )
                            } else {
                                Icon(
                                    if (playing) Icons.Rounded.Pause else Icons.Rounded.PlayArrow,
                                    contentDescription = if (playing) "Пауза" else "Играть",
                                    tint = Color(0xFF071018),
                                    modifier = Modifier.size(32.dp)
                                )
                            }
                        }
                        StepButton(Icons.Rounded.SkipNext, "Следующий", onNext)
                        RoundAction(
                            icon = if (liked) Icons.Rounded.Favorite else Icons.Rounded.FavoriteBorder,
                            description = if (liked) "Убрать из нравится" else "Нравится",
                            size = 48,
                            iconSize = 21,
                            active = liked,
                            onClick = onLike
                        )
                    }

                    Spacer(Modifier.height(14.dp))
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.Center,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        RoundAction(
                            icon = Icons.Rounded.Shuffle,
                            description = if (shuffle) "Перемешивание включено" else "Перемешать очередь",
                            size = 46,
                            iconSize = 20,
                            active = shuffle,
                            modifier = Modifier.offset(x = (-30).dp, y = 8.dp),
                            onClick = onToggleShuffle
                        )
                        Spacer(Modifier.width(16.dp))
                        RoundAction(
                            icon = if (repeatMode == 2) Icons.Rounded.RepeatOne else Icons.Rounded.Repeat,
                            description = when (repeatMode) {
                                2 -> "Повтор трека"
                                1 -> "Повтор очереди"
                                else -> "Повтор выключен"
                            },
                            size = 46,
                            iconSize = 20,
                            active = repeatMode > 0,
                            modifier = Modifier.offset(x = 30.dp, y = 8.dp),
                            onClick = onCycleRepeat
                        )
                    }
                    Spacer(Modifier.height(18.dp))
                }

                Row(
                    Modifier
                        .fillMaxWidth()
                        .padding(start = 22.dp, end = 22.dp, top = 6.dp, bottom = 16.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    BottomAction(
                        icon = Icons.Rounded.PlaylistAdd,
                        description = "Добавить в плейлист",
                        modifier = Modifier.weight(1f),
                        onClick = onAddToPlaylist
                    )
                    BottomAction(
                        icon = Icons.Rounded.QueueMusic,
                        description = "Открыть очередь",
                        modifier = Modifier.weight(1f),
                        onClick = onOpenQueue
                    )
                }
            }
        }
    }
}

@Composable
private fun MetaPill(text: String, color: Color = Muted) {
    Box(
        Modifier
            .clip(RoundedCornerShape(5.dp))
            .background(Color.White.copy(alpha = 0.055f))
            .padding(horizontal = 7.dp, vertical = 2.dp)
    ) {
        Text(text, color = color, fontSize = 9.5.sp, maxLines = 1)
    }
}

@Composable
private fun StepButton(icon: ImageVector, description: String, onClick: () -> Unit) {
    Box(
        Modifier
            .size(50.dp)
            .clip(CircleShape)
            .background(Color.White.copy(alpha = 0.035f))
            .border(1.dp, Color.White.copy(alpha = 0.06f), CircleShape)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center
    ) {
        Icon(
            icon,
            contentDescription = description,
            tint = TextMain,
            modifier = Modifier.size(26.dp)
        )
    }
}

@Composable
private fun RoundAction(
    icon: ImageVector,
    description: String,
    size: Int,
    iconSize: Int,
    active: Boolean = false,
    busy: Boolean = false,
    modifier: Modifier = Modifier,
    onClick: () -> Unit
) {
    Box(
        modifier
            .size(size.dp)
            .clip(CircleShape)
            .background(
                if (active) Teal.copy(alpha = 0.12f) else Color.White.copy(alpha = 0.035f)
            )
            .border(
                1.dp,
                if (active) Teal.copy(alpha = 0.25f) else Color.White.copy(alpha = 0.06f),
                CircleShape
            )
            .clickable(enabled = !busy, onClick = onClick),
        contentAlignment = Alignment.Center
    ) {
        if (busy) {
            CircularProgressIndicator(
                modifier = Modifier.size(iconSize.dp),
                color = Teal,
                strokeWidth = 1.8.dp
            )
        } else {
            Icon(
                icon,
                contentDescription = description,
                tint = if (active) Mint else TextDim,
                modifier = Modifier.size(iconSize.dp)
            )
        }
    }
}

@Composable
private fun BottomAction(
    icon: ImageVector,
    description: String,
    modifier: Modifier = Modifier,
    onClick: () -> Unit
) {
    Box(
        modifier
            .height(52.dp)
            .clip(RoundedCornerShape(15.dp))
            .background(Color.White.copy(alpha = 0.045f))
            .border(1.dp, Color.White.copy(alpha = 0.08f), RoundedCornerShape(15.dp))
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center
    ) {
        Icon(
            icon,
            contentDescription = description,
            tint = TextDim,
            modifier = Modifier.size(24.dp)
        )
    }
}
