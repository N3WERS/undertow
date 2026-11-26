package co.undertow.mobile

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
fun FlowScreen(
    tracks: List<TrackItem>,
    seeds: List<FlowSeed>,
    loading: Boolean,
    refilling: Boolean,
    error: String?,
    downloads: Map<String, java.io.File>,
    downloading: Set<String>,
    likedKeys: Set<String>,
    activeKey: String?,
    onStart: () -> Unit,
    onPlay: (TrackItem, List<TrackItem>) -> Unit,
    onLike: (TrackItem) -> Unit,
    onDownload: (TrackItem) -> Unit
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(bottom = 30.dp)
    ) {
        item {
            Column(Modifier.padding(start = 22.dp, end = 22.dp, bottom = 4.dp)) {
                Text(
                    "Течение",
                    color = TextMain,
                    fontSize = 25.sp,
                    fontWeight = FontWeight.SemiBold,
                    letterSpacing = (-0.3).sp
                )
                Spacer(Modifier.height(2.dp))
                Text(
                    "Бесконечный поток от артистов, которых ты слушаешь",
                    color = Muted,
                    fontSize = 12.sp
                )
            }
        }

        item {
            TopoHero(
                hasTracks = tracks.isNotEmpty(),
                loading = loading,
                onPlay = {
                    if (tracks.isNotEmpty()) onPlay(tracks.first(), tracks)
                },
                onStart = onStart
            )
        }

        if (seeds.isNotEmpty()) {
            item {
                Column(Modifier.padding(top = 18.dp)) {
                    Text(
                        "ОТКУДА ТЕЧЁТ",
                        color = Muted,
                        fontSize = 9.5.sp,
                        fontWeight = FontWeight.SemiBold,
                        letterSpacing = 1.5.sp,
                        modifier = Modifier.padding(start = 22.dp, bottom = 8.dp)
                    )
                    LazyRow(
                        contentPadding = PaddingValues(horizontal = 22.dp),
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        items(seeds, key = { it.name }) { seed ->
                            Box(
                                Modifier
                                    .clip(RoundedCornerShape(99.dp))
                                    .background(Teal.copy(alpha = 0.07f))
                                    .border(1.dp, Teal.copy(alpha = 0.18f), RoundedCornerShape(99.dp))
                                    .padding(horizontal = 10.dp, vertical = 5.dp)
                            ) {
                                Text(
                                    seed.name,
                                    color = TextDim,
                                    fontSize = 10.5.sp,
                                    maxLines = 1
                                )
                            }
                        }
                    }
                }
            }
        }

        if (loading && tracks.isEmpty()) {
            item {
                FlowNotice(
                    title = "Собираем течение",
                    text = "Ищем соседей твоих артистов и набираем треки. Это может занять несколько секунд.",
                    loading = true
                )
            }
        } else if (tracks.isEmpty()) {
            item {
                FlowNotice(
                    title = "Поток ещё не запущен",
                    text = error ?: "Течение собирается из твоих лайков и истории. Чем больше слушаешь, тем точнее оно становится.",
                    error = error != null
                )
            }
        }

        if (error != null && tracks.isNotEmpty()) {
            item {
                FlowNotice(
                    title = "Поток не пересобрался",
                    text = error,
                    error = true
                )
            }
        }

        if (tracks.isNotEmpty()) {
            item {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .padding(start = 22.dp, end = 22.dp, top = 24.dp, bottom = 10.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(
                            "В потоке",
                            color = TextMain,
                            fontSize = 15.5.sp,
                            fontWeight = FontWeight.SemiBold,
                            letterSpacing = (-0.1).sp
                        )
                        Spacer(Modifier.height(1.dp))
                        Text(
                            "${tracks.size} ${tracksWord(tracks.size)} · " +
                                if (refilling) "догружаем дальше…" else "продолжается сам",
                            color = Muted,
                            fontSize = 10.5.sp
                        )
                    }
                    if (loading) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(15.dp),
                            color = Teal,
                            strokeWidth = 1.8.dp
                        )
                    }
                }
            }
            item {
                LazyRow(
                    contentPadding = PaddingValues(start = 22.dp, end = 22.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    items(tracks.take(18), key = { it.key }) { track ->
                        HomeCard(
                            track = track,
                            liked = likedKeys.contains(track.key),
                            downloaded = downloads.containsKey(track.key),
                            downloading = downloading.contains(track.key),
                            active = activeKey == track.key,
                            onPlay = { onPlay(track, tracks) },
                            onLike = { onLike(track) },
                            onDownload = { onDownload(track) }
                        )
                    }
                }
            }
            item {
                Box(
                    Modifier
                        .fillMaxWidth()
                        .padding(start = 22.dp, end = 22.dp, top = 20.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .background(Surface.copy(alpha = 0.55f))
                        .border(1.dp, Line, RoundedCornerShape(12.dp))
                        .padding(horizontal = 14.dp, vertical = 12.dp)
                ) {
                    Text(
                        "Поток идёт от любимых артистов к их соседям. Свои треки попадают в него редко, поэтому очередь всё время уходит в новое. Когда пулы заканчиваются, подключается второй круг.",
                        color = Muted,
                        fontSize = 11.5.sp,
                        lineHeight = 16.sp
                    )
                }
            }
        }
    }
}

@Composable
private fun FlowNotice(
    title: String,
    text: String,
    loading: Boolean = false,
    error: Boolean = false
) {
    Box(
        Modifier
            .fillMaxWidth()
            .padding(start = 22.dp, end = 22.dp, top = 18.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(Surface.copy(alpha = 0.55f))
            .border(1.dp, if (error) Danger.copy(alpha = 0.35f) else Line, RoundedCornerShape(12.dp))
            .padding(horizontal = 14.dp, vertical = 14.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (loading) {
                CircularProgressIndicator(
                    modifier = Modifier.size(20.dp),
                    color = Teal,
                    strokeWidth = 2.dp
                )
                Spacer(Modifier.width(12.dp))
            }
            Column {
                Text(
                    title,
                    color = if (error) Color(0xFFFF9A9A) else TextMain,
                    fontSize = 12.5.sp,
                    fontWeight = FontWeight.SemiBold
                )
                Spacer(Modifier.height(2.dp))
                Text(text, color = Muted, fontSize = 11.5.sp, lineHeight = 16.sp)
            }
        }
    }
}

@Composable
private fun TopoHero(
    hasTracks: Boolean,
    loading: Boolean,
    onPlay: () -> Unit,
    onStart: () -> Unit
) {
    val shape = RoundedCornerShape(18.dp)
    Box(
        Modifier
            .padding(start = 22.dp, end = 22.dp, top = 14.dp)
            .fillMaxWidth()
            .height(210.dp)
            .clip(shape)
            .background(
                Brush.linearGradient(
                    listOf(Color(0xFF0A2528), Color(0xFF111A2A), Color(0xFF16122B)),
                    start = Offset.Zero,
                    end = Offset(900f, 500f)
                )
            )
            .border(1.dp, Line, shape)
    ) {
        Canvas(Modifier.fillMaxSize()) {
            val w = size.width
            val h = size.height
            val colors = listOf(Teal.copy(alpha = 0.20f), Indigo.copy(alpha = 0.13f))
            for (i in 0 until 8) {
                val y = h * (0.15f + i * 0.11f)
                val p = Path().apply {
                    moveTo(-20f, y)
                    cubicTo(w * 0.22f, y - 34f, w * 0.42f, y + 42f, w * 0.62f, y + 2f)
                    cubicTo(w * 0.78f, y - 28f, w * 0.9f, y + 24f, w + 20f, y - 6f)
                }
                drawPath(p, colors[i % colors.size], style = Stroke(width = 1.1f))
            }
            drawCircle(Teal.copy(alpha = 0.10f), radius = 130f, center = Offset(w * 0.84f, h * 0.22f))
            drawCircle(Indigo.copy(alpha = 0.08f), radius = 100f, center = Offset(w * 0.1f, h * 0.9f))
        }

        Column(
            Modifier
                .align(Alignment.CenterStart)
                .padding(start = 22.dp, end = 22.dp)
        ) {
            Text(
                "UNDERTOW",
                color = Teal,
                fontSize = 10.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 2.2.sp
            )
            Spacer(Modifier.height(6.dp))
            Text(
                "Течение",
                color = TextMain,
                fontSize = 34.sp,
                fontWeight = FontWeight.SemiBold,
                letterSpacing = (-0.6).sp
            )
            Spacer(Modifier.height(2.dp))
            Text(
                "бесконечный поток новой музыки",
                color = Muted,
                fontSize = 12.5.sp
            )
            Spacer(Modifier.height(20.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Row(
                    Modifier
                        .clip(RoundedCornerShape(99.dp))
                        .background(
                            if (!loading) {
                                Brush.verticalGradient(listOf(Color(0xFF4CE6DF), Color(0xFF2EC2BB)))
                            } else {
                                Brush.verticalGradient(listOf(Line, Line))
                            }
                        )
                        .clickable(enabled = !loading, onClick = if (hasTracks) onPlay else onStart)
                        .padding(horizontal = 18.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    if (loading) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(15.dp),
                            color = Color(0xFF04211F),
                            strokeWidth = 1.8.dp
                        )
                    } else {
                        Icon(
                            Icons.Rounded.PlayArrow,
                            contentDescription = null,
                            tint = Color(0xFF04211F),
                            modifier = Modifier.size(18.dp)
                        )
                    }
                    Spacer(Modifier.width(6.dp))
                    Text(
                        when {
                            loading && !hasTracks -> "Собираем…"
                            hasTracks -> "Слушать"
                            else -> "Собрать течение"
                        },
                        color = Color(0xFF04211F),
                        fontSize = 12.5.sp,
                        fontWeight = FontWeight.SemiBold
                    )
                }
                if (hasTracks && !loading) {
                    Spacer(Modifier.width(8.dp))
                    Row(
                        Modifier
                            .clip(RoundedCornerShape(99.dp))
                            .background(Color.White.copy(alpha = 0.045f))
                            .border(1.dp, Line, RoundedCornerShape(99.dp))
                            .clickable(onClick = onStart)
                            .padding(horizontal = 12.dp, vertical = 9.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            Icons.Rounded.Refresh,
                            contentDescription = null,
                            tint = TextDim,
                            modifier = Modifier.size(15.dp)
                        )
                        Spacer(Modifier.width(5.dp))
                        Text("Заново", color = TextDim, fontSize = 11.sp)
                    }
                }
            }
        }
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
