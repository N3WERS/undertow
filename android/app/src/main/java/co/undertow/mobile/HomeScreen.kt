package co.undertow.mobile

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
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage

@Composable
fun HomeScreen(
    newTracks: List<TrackItem>,
    trending: List<TrackItem>,
    history: List<HistoryEntry>,
    chartTracks: List<TrackItem>,
    chartLoading: Boolean,
    chartError: String?,
    chartScope: String,
    onChartScope: (String) -> Unit,
    onOpenChart: () -> Unit,
    loading: Boolean,
    downloads: Map<String, java.io.File>,
    downloading: Set<String>,
    likedKeys: Set<String>,
    activeKey: String?,
    onPlay: (TrackItem, List<TrackItem>) -> Unit,
    onLike: (TrackItem) -> Unit,
    onDownload: (TrackItem) -> Unit
) {
    val continueTracks = history.map { it.track }.distinctBy { it.key }.take(18)

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(bottom = 30.dp)
    ) {
        item {
            Column(Modifier.padding(start = 22.dp, end = 22.dp, bottom = 4.dp)) {
                Text(
                    "Главная",
                    color = TextMain,
                    fontSize = 25.sp,
                    fontWeight = FontWeight.SemiBold,
                    letterSpacing = (-0.3).sp
                )
                Spacer(Modifier.height(2.dp))
                Text(
                    "Новинки и тренды · обновлено только что",
                    color = Muted,
                    fontSize = 12.sp
                )
            }
        }

        item {
            ChartHero(
                tracks = chartTracks,
                loading = chartLoading,
                error = chartError,
                scope = chartScope,
                onScope = onChartScope,
                onOpenChart = onOpenChart,
                onPlayAll = {
                    if (chartTracks.isNotEmpty()) onPlay(chartTracks.first(), chartTracks)
                },
                onPlayTrack = { track -> onPlay(track, chartTracks) }
            )
        }

        item {
            HomeSectionHeader(
                title = "Новинки",
                subtitle = if (loading) "загружаю…" else "${newTracks.size} ${tracksWord(newTracks.size)}",
                trailing = if (loading) {
                    { CircularProgressIndicator(modifier = Modifier.size(15.dp), color = Teal, strokeWidth = 1.6.dp) }
                } else {
                    { Text("YouTube Music", color = Muted, fontSize = 10.5.sp) }
                }
            )
        }
        item {
            if (newTracks.isEmpty() && !loading) {
                HomeEmpty("Не удалось загрузить новинки — открой поиск и найди трек вручную.")
            } else if (newTracks.isNotEmpty()) {
                HomeShelf(
                    items = newTracks,
                    activeKey = activeKey,
                    downloads = downloads,
                    downloading = downloading,
                    likedKeys = likedKeys,
                    onPlay = onPlay,
                    onLike = onLike,
                    onDownload = onDownload
                )
            }
        }

        if (trending.isNotEmpty()) {
            item {
                HomeSectionHeader(
                    title = "Сейчас в тренде",
                    subtitle = "топ-3 · ${trending.size} ${tracksWord(trending.size)}",
                    action = "Слушать всё",
                    onAction = { onPlay(trending.first(), trending) }
                )
            }
            item {
                TrendingBlock(
                    tracks = trending.take(3),
                    activeKey = activeKey,
                    onPlay = { track -> onPlay(track, trending) }
                )
            }
        }

        if (continueTracks.isNotEmpty()) {
            item {
                HomeSectionHeader(
                    title = "Продолжить",
                    subtitle = "${continueTracks.size} ${tracksWord(continueTracks.size)} из истории"
                )
            }
            item {
                HomeShelf(
                    items = continueTracks,
                    activeKey = activeKey,
                    downloads = downloads,
                    downloading = downloading,
                    likedKeys = likedKeys,
                    onPlay = onPlay,
                    onLike = onLike,
                    onDownload = onDownload
                )
            }
        }
    }
}

@Composable
private fun ChartHero(
    tracks: List<TrackItem>,
    loading: Boolean,
    error: String?,
    scope: String,
    onScope: (String) -> Unit,
    onOpenChart: () -> Unit,
    onPlayAll: () -> Unit,
    onPlayTrack: (TrackItem) -> Unit
) {
    val shape = RoundedCornerShape(18.dp)
    val region = when (scope) {
        "us" -> "США · YouTube Music"
        "world" -> "Мир · YouTube Music"
        else -> "Россия · YouTube Music"
    }
    Column(
        Modifier
            .fillMaxWidth()
            .padding(start = 22.dp, end = 22.dp, top = 18.dp)
            .clip(shape)
            .background(
                Brush.linearGradient(
                    listOf(Color(0xFF101B28), Color(0xFF0B111A)),
                    start = Offset.Zero,
                    end = Offset(900f, 700f)
                )
            )
            .border(1.dp, LineStrong, shape)
            .padding(14.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(6.dp).clip(RoundedCornerShape(50)).background(Teal))
            Spacer(Modifier.width(8.dp))
            Text(
                "ЧАРТ НЕДЕЛИ",
                color = Muted,
                fontSize = 9.5.sp,
                fontWeight = FontWeight.SemiBold,
                letterSpacing = 1.6.sp
            )
            Spacer(Modifier.weight(1f))
            ChartScopeChip("РФ", scope == "ru") { onScope("ru") }
            Spacer(Modifier.width(4.dp))
            ChartScopeChip("США", scope == "us") { onScope("us") }
            Spacer(Modifier.width(4.dp))
            ChartScopeChip("МИР", scope == "world") { onScope("world") }
        }

        Spacer(Modifier.height(10.dp))
        Row(verticalAlignment = Alignment.Bottom) {
            Text(
                "Топ",
                color = TextMain,
                fontSize = 29.sp,
                fontWeight = FontWeight.SemiBold,
                letterSpacing = (-0.5).sp
            )
            Spacer(Modifier.width(7.dp))
            Text(
                "100",
                color = Teal,
                fontSize = 29.sp,
                fontWeight = FontWeight.SemiBold,
                letterSpacing = (-0.5).sp
            )
        }
        Text(
            "Самые популярные композиции недели",
            color = Muted,
            fontSize = 11.5.sp
        )
        Spacer(Modifier.height(2.dp))
        Text(region, color = Muted, fontSize = 10.sp)

        Spacer(Modifier.height(13.dp))
        when {
            tracks.isEmpty() && loading -> Box(
                Modifier.fillMaxWidth().height(116.dp),
                contentAlignment = Alignment.Center
            ) {
                CircularProgressIndicator(
                    modifier = Modifier.size(22.dp),
                    color = Teal,
                    strokeWidth = 2.dp
                )
            }
            tracks.isEmpty() -> Text(
                error ?: "Чарт не загрузился",
                color = Muted,
                fontSize = 11.5.sp,
                modifier = Modifier.padding(vertical = 16.dp)
            )
            else -> Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                tracks.take(3).forEachIndexed { index, track ->
                    ChartPodiumCard(
                        track = track,
                        rank = index + 1,
                        modifier = Modifier.weight(1f),
                        onClick = { onPlayTrack(track) }
                    )
                }
            }
        }

        Spacer(Modifier.height(14.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Row(
                Modifier
                    .clip(RoundedCornerShape(99.dp))
                    .background(
                        if (tracks.isNotEmpty()) {
                            Brush.verticalGradient(listOf(Color(0xFF4CE6DF), Color(0xFF2EC2BB)))
                        } else {
                            Brush.verticalGradient(listOf(Line, Line))
                        }
                    )
                    .clickable(enabled = tracks.isNotEmpty(), onClick = onPlayAll)
                    .padding(horizontal = 14.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(
                    Icons.Rounded.PlayArrow,
                    contentDescription = null,
                    tint = if (tracks.isNotEmpty()) Color(0xFF04211F) else Muted,
                    modifier = Modifier.size(16.dp)
                )
                Spacer(Modifier.width(5.dp))
                Text(
                    "Слушать чарт",
                    color = if (tracks.isNotEmpty()) Color(0xFF04211F) else Muted,
                    fontSize = 11.5.sp,
                    fontWeight = FontWeight.SemiBold
                )
            }
            Spacer(Modifier.width(8.dp))
            Box(
                Modifier
                    .clip(RoundedCornerShape(99.dp))
                    .background(Color.White.copy(alpha = 0.045f))
                    .border(1.dp, Line, RoundedCornerShape(99.dp))
                    .clickable(enabled = tracks.isNotEmpty(), onClick = onOpenChart)
                    .padding(horizontal = 13.dp, vertical = 8.dp)
            ) {
                Text(
                    "Весь список",
                    color = if (tracks.isNotEmpty()) TextDim else Muted,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Medium
                )
            }
        }
    }
}

@Composable
private fun ChartScopeChip(label: String, selected: Boolean, onClick: () -> Unit) {
    Box(
        Modifier
            .clip(RoundedCornerShape(6.dp))
            .background(if (selected) Teal.copy(alpha = 0.12f) else Color.Transparent)
            .border(
                1.dp,
                if (selected) Teal.copy(alpha = 0.25f) else Line,
                RoundedCornerShape(6.dp)
            )
            .clickable(onClick = onClick)
            .padding(horizontal = 7.dp, vertical = 3.dp)
    ) {
        Text(
            label,
            color = if (selected) Teal else Muted,
            fontSize = 9.sp,
            fontWeight = FontWeight.Medium
        )
    }
}

@Composable
private fun ChartPodiumCard(
    track: TrackItem,
    rank: Int,
    modifier: Modifier = Modifier,
    onClick: () -> Unit
) {
    Column(modifier.clickable(onClick = onClick)) {
        Box(
            Modifier
                .fillMaxWidth()
                .aspectRatio(1f)
                .clip(RoundedCornerShape(10.dp))
                .background(Surface2)
                .border(1.dp, Line, RoundedCornerShape(10.dp))
        ) {
            AsyncImage(
                model = track.thumbnail,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize()
            )
            Box(
                Modifier
                    .align(Alignment.TopStart)
                    .padding(5.dp)
                    .clip(RoundedCornerShape(5.dp))
                    .background(Color(0xD9080C11))
                    .padding(horizontal = 5.dp, vertical = 1.dp)
            ) {
                Text(
                    "0$rank",
                    color = if (rank == 1) Teal else TextMain,
                    fontSize = 9.sp,
                    fontWeight = FontWeight.Bold
                )
            }
        }
        Spacer(Modifier.height(6.dp))
        Text(
            track.title,
            color = TextMain,
            fontSize = 10.5.sp,
            fontWeight = FontWeight.Medium,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
        Text(
            track.artist,
            color = Muted,
            fontSize = 9.5.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
    }
}

@Composable
private fun HomeSectionHeader(
    title: String,
    subtitle: String,
    trailing: (@Composable () -> Unit)? = null,
    action: String? = null,
    onAction: (() -> Unit)? = null
) {
    Column(
        Modifier
            .fillMaxWidth()
            .padding(start = 22.dp, end = 22.dp, top = 24.dp, bottom = 10.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                title,
                color = TextMain,
                fontSize = 15.5.sp,
                fontWeight = FontWeight.SemiBold,
                letterSpacing = (-0.1).sp
            )
            Spacer(Modifier.weight(1f))
            if (action != null && onAction != null) {
                Box(
                    Modifier
                        .clip(RoundedCornerShape(7.dp))
                        .clickable(onClick = onAction)
                        .padding(horizontal = 8.dp, vertical = 4.dp)
                ) {
                    Text(action, color = Teal, fontSize = 11.sp, fontWeight = FontWeight.Medium)
                }
            } else {
                trailing?.invoke()
            }
        }
        Spacer(Modifier.height(1.dp))
        Text(subtitle, color = Muted, fontSize = 10.5.sp)
    }
}

@Composable
private fun HomeShelf(
    items: List<TrackItem>,
    activeKey: String?,
    downloads: Map<String, java.io.File>,
    downloading: Set<String>,
    likedKeys: Set<String>,
    onPlay: (TrackItem, List<TrackItem>) -> Unit,
    onLike: (TrackItem) -> Unit,
    onDownload: (TrackItem) -> Unit
) {
    LazyRow(
        contentPadding = PaddingValues(start = 22.dp, end = 22.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        items(items, key = { it.key }) { track ->
            HomeCard(
                track = track,
                liked = likedKeys.contains(track.key),
                downloaded = downloads.containsKey(track.key),
                downloading = downloading.contains(track.key),
                active = activeKey == track.key,
                onPlay = { onPlay(track, items) },
                onLike = { onLike(track) },
                onDownload = { onDownload(track) }
            )
        }
    }
}

@Composable
private fun TrendingBlock(
    tracks: List<TrackItem>,
    activeKey: String?,
    onPlay: (TrackItem) -> Unit
) {
    val shape = RoundedCornerShape(14.dp)
    Column(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 22.dp)
            .clip(shape)
            .background(Surface.copy(alpha = 0.55f))
            .border(1.dp, Line, shape)
            .padding(6.dp)
    ) {
        tracks.forEachIndexed { index, track ->
            val active = activeKey == track.key
            Row(
                Modifier
                    .fillMaxWidth()
                    .height(54.dp)
                    .clip(RoundedCornerShape(9.dp))
                    .background(if (active) Teal.copy(alpha = 0.08f) else Color.Transparent)
                    .clickable { onPlay(track) }
                    .padding(horizontal = 7.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    "0${index + 1}",
                    color = if (index == 0) Teal else Muted,
                    fontSize = 11.5.sp,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.width(28.dp)
                )
                AsyncImage(
                    model = track.thumbnail,
                    contentDescription = null,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier
                        .size(40.dp)
                        .clip(RoundedCornerShape(7.dp))
                        .background(Surface2)
                        .border(1.dp, if (active) Teal.copy(alpha = 0.5f) else Line, RoundedCornerShape(7.dp))
                )
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        track.title,
                        color = if (active) Teal else TextMain,
                        fontSize = 12.5.sp,
                        fontWeight = FontWeight.Medium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                    Text(
                        track.artist,
                        color = Muted,
                        fontSize = 10.5.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
                Text(track.durationText, color = Muted, fontSize = 10.sp)
            }
        }
    }
}

@Composable
private fun HomeEmpty(text: String) {
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
