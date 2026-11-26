package co.undertow.mobile

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.Favorite
import androidx.compose.material.icons.rounded.FavoriteBorder
import androidx.compose.material.icons.rounded.PlaylistAdd
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage

@Composable
fun TrackActions(
    liked: Boolean,
    downloaded: Boolean,
    downloading: Boolean,
    onLike: () -> Unit,
    onDownload: () -> Unit,
    onAdd: (() -> Unit)? = null,
    onRemove: (() -> Unit)? = null,
    modifier: Modifier = Modifier
) {
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onLike, modifier = Modifier.size(30.dp)) {
            Icon(
                if (liked) Icons.Rounded.Favorite else Icons.Rounded.FavoriteBorder,
                contentDescription = if (liked) "Убрать лайк" else "Мне нравится",
                tint = if (liked) Color(0xFFF2547D) else Muted,
                modifier = Modifier.size(18.dp)
            )
        }
        IconButton(onClick = onDownload, enabled = !downloading, modifier = Modifier.size(30.dp)) {
            when {
                downloading -> CircularProgressIndicator(
                    modifier = Modifier.size(16.dp),
                    color = Teal,
                    strokeWidth = 1.7.dp
                )
                downloaded -> Icon(Icons.Rounded.Check, contentDescription = "Скачано", tint = Teal, modifier = Modifier.size(18.dp))
                else -> Icon(Icons.Rounded.Download, contentDescription = "Скачать", tint = Muted, modifier = Modifier.size(18.dp))
            }
        }
        if (onRemove != null) {
            IconButton(onClick = onRemove, modifier = Modifier.size(30.dp)) {
                Icon(Icons.Rounded.Close, contentDescription = "Убрать из плейлиста", tint = Muted, modifier = Modifier.size(17.dp))
            }
        } else if (onAdd != null) {
            IconButton(onClick = onAdd, modifier = Modifier.size(30.dp)) {
                Icon(Icons.Rounded.PlaylistAdd, contentDescription = "В плейлист", tint = Muted, modifier = Modifier.size(19.dp))
            }
        }
    }
}

@Composable
fun HomeCard(
    track: TrackItem,
    liked: Boolean,
    downloaded: Boolean,
    downloading: Boolean,
    active: Boolean = false,
    onPlay: () -> Unit,
    onLike: () -> Unit,
    onDownload: () -> Unit
) {
    val shape = RoundedCornerShape(13.dp)
    Column(Modifier.width(136.dp)) {
        Box(
            Modifier
                .size(136.dp)
                .clip(shape)
                .background(Surface2)
                .border(1.dp, if (active) Teal.copy(alpha = 0.55f) else Line, shape)
                .clickable(onClick = onPlay)
        ) {
            AsyncImage(
                model = track.thumbnail,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize()
            )
            Row(
                Modifier.align(Alignment.TopEnd).padding(5.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                Box(
                    Modifier
                        .size(28.dp)
                        .clip(RoundedCornerShape(50))
                        .background(Color(0xD9080C11))
                        .clickable(onClick = onLike),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        if (liked) Icons.Rounded.Favorite else Icons.Rounded.FavoriteBorder,
                        contentDescription = null,
                        tint = if (liked) Color(0xFFF2547D) else Color(0xFFD5E2EC),
                        modifier = Modifier.size(16.dp)
                    )
                }
                Box(
                    Modifier
                        .size(28.dp)
                        .clip(RoundedCornerShape(50))
                        .background(Color(0xD9080C11))
                        .clickable(enabled = !downloading, onClick = onDownload),
                    contentAlignment = Alignment.Center
                ) {
                    when {
                        downloading -> CircularProgressIndicator(modifier = Modifier.size(13.dp), color = Teal, strokeWidth = 1.4.dp)
                        downloaded -> Icon(Icons.Rounded.Check, contentDescription = null, tint = Teal, modifier = Modifier.size(16.dp))
                        else -> Icon(Icons.Rounded.Download, contentDescription = null, tint = Color(0xFFD5E2EC), modifier = Modifier.size(16.dp))
                    }
                }
            }
        }
        Spacer(Modifier.height(7.dp))
        Text(
            track.title,
            color = if (active) Teal else TextMain,
            fontSize = 12.5.sp,
            fontWeight = FontWeight.SemiBold,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            lineHeight = 15.sp
        )
        Spacer(Modifier.height(2.dp))
        Text(
            track.artist,
            color = Muted,
            fontSize = 10.5.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
    }
}

@Composable
fun TrackRow(
    track: TrackItem,
    liked: Boolean,
    downloaded: Boolean,
    downloading: Boolean,
    active: Boolean,
    meta: String? = null,
    index: Int? = null,
    onPlay: () -> Unit,
    onLike: () -> Unit,
    onDownload: () -> Unit,
    onAddToPlaylist: (() -> Unit)? = null,
    onRemoveFromPlaylist: (() -> Unit)? = null
) {
    val shape = RoundedCornerShape(10.dp)
    Row(
        Modifier.fillMaxWidth()
            .clip(shape)
            .background(
                if (active) Brush.horizontalGradient(
                    listOf(Teal.copy(alpha = 0.10f), Teal.copy(alpha = 0.02f))
                ) else SolidColor(Color.Transparent)
            )
            .then(if (active) Modifier.border(1.dp, Teal.copy(alpha = 0.13f), shape) else Modifier)
            .clickable(onClick = onPlay)
            .padding(start = 6.dp, end = 6.dp, top = 5.dp, bottom = 5.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        if (index != null) {
            Text(
                index.toString(),
                color = Muted,
                fontSize = 11.sp,
                modifier = Modifier.width(20.dp),
                textAlign = TextAlign.Center
            )
        }
        AsyncImage(
            model = track.thumbnail,
            contentDescription = null,
            contentScale = ContentScale.Crop,
            modifier = Modifier
                .size(42.dp)
                .clip(RoundedCornerShape(8.dp))
                .background(Line)
                .border(1.dp, Line, RoundedCornerShape(8.dp))
        )
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Text(
                track.title,
                color = if (active) Teal else TextMain,
                fontSize = 13.5.sp,
                fontWeight = FontWeight.Medium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            Spacer(Modifier.height(2.dp))
            Text(
                meta ?: "${track.artist} · ${track.durationText}",
                color = Muted,
                fontSize = 11.5.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
        TrackActions(
            liked = liked,
            downloaded = downloaded,
            downloading = downloading,
            onLike = onLike,
            onDownload = onDownload,
            onAdd = onAddToPlaylist,
            onRemove = onRemoveFromPlaylist
        )
    }
}
