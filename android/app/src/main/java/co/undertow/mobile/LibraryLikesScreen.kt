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
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
internal fun LibraryTrackListScreen(
    title: String,
    tracks: List<TrackItem>,
    emptyTitle: String,
    emptyText: String,
    downloads: Map<String, java.io.File>,
    downloading: Set<String>,
    likedKeys: Set<String>,
    activeKey: String?,
    onBack: () -> Unit,
    onPlay: (TrackItem, List<TrackItem>) -> Unit,
    onLike: (TrackItem) -> Unit,
    onDownload: (TrackItem) -> Unit,
    onAddToPlaylist: (TrackItem) -> Unit,
    onClear: (() -> Unit)? = null
) {
    Column(Modifier.fillMaxSize()) {
        Row(
            Modifier
                .fillMaxWidth()
                .padding(start = 16.dp, end = 14.dp, bottom = 8.dp),
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
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    title,
                    color = TextMain,
                    fontSize = 22.sp,
                    fontWeight = FontWeight.SemiBold,
                    letterSpacing = (-0.2).sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Text(
                    "${tracks.size} ${playlistTracksWord(tracks.size)}",
                    color = Muted,
                    fontSize = 11.sp
                )
            }
            if (onClear != null && tracks.isNotEmpty()) {
                Box(
                    Modifier
                        .clip(RoundedCornerShape(8.dp))
                        .clickable(onClick = onClear)
                        .padding(horizontal = 8.dp, vertical = 6.dp)
                ) {
                    Text("Очистить", color = Muted, fontSize = 11.5.sp)
                }
            } else if (tracks.isNotEmpty()) {
                Box(
                    Modifier
                        .clip(RoundedCornerShape(99.dp))
                        .background(
                            Brush.verticalGradient(
                                listOf(Color(0xFF4CE6DF), Color(0xFF2EC2BB))
                            )
                        )
                        .clickable { onPlay(tracks.first(), tracks) }
                        .padding(horizontal = 12.dp, vertical = 7.dp)
                ) {
                    Text(
                        "Слушать всё",
                        color = Color(0xFF04211F),
                        fontSize = 11.sp,
                        fontWeight = FontWeight.SemiBold
                    )
                }
            }
        }

        if (tracks.isEmpty()) {
            Column(
                Modifier.fillMaxSize().padding(horizontal = 28.dp, vertical = 54.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Text(
                    emptyTitle,
                    color = TextDim,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Medium,
                    textAlign = TextAlign.Center
                )
                Spacer(Modifier.height(5.dp))
                Text(
                    emptyText,
                    color = Muted,
                    fontSize = 12.5.sp,
                    lineHeight = 18.sp,
                    textAlign = TextAlign.Center
                )
            }
        } else {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(start = 10.dp, end = 8.dp, top = 6.dp, bottom = 28.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp)
            ) {
                itemsIndexed(tracks, key = { _, track -> track.key }) { index, track ->
                    TrackRow(
                        track = track,
                        liked = likedKeys.contains(track.key),
                        downloaded = downloads.containsKey(track.key),
                        downloading = downloading.contains(track.key),
                        active = activeKey == track.key,
                        index = index + 1,
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
