package co.undertow.mobile

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items as gridItems
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import kotlinx.coroutines.launch

private enum class SearchMode { TRACKS, ALBUMS, ARTISTS }

@Composable
fun SearchScreen(
    repo: MusicRepository,
    likedKeys: Set<String>,
    downloads: Map<String, java.io.File>,
    downloading: Set<String>,
    activeKey: String?,
    onPlay: (TrackItem, List<TrackItem>) -> Unit,
    onLike: (TrackItem) -> Unit,
    onDownload: (TrackItem) -> Unit,
    onAddToPlaylist: (TrackItem) -> Unit,
    onOpenAlbum: (AlbumRef) -> Unit,
    onOpenArtist: (ArtistRef) -> Unit
) {
    val scope = rememberCoroutineScope()
    val focus = LocalFocusManager.current
    var query by remember { mutableStateOf("") }
    var mode by remember { mutableStateOf(SearchMode.TRACKS) }
    var results by remember { mutableStateOf<List<TrackItem>>(emptyList()) }
    var albums by remember { mutableStateOf<List<AlbumRef>>(emptyList()) }
    var artists by remember { mutableStateOf<List<ArtistRef>>(emptyList()) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var focused by remember { mutableStateOf(false) }

    fun run(forced: String? = null, modeOverride: SearchMode? = null) {
        val term = (forced ?: query).trim()
        if (term.isEmpty() || busy) return
        val target = modeOverride ?: mode
        focus.clearFocus()
        busy = true
        error = null
        scope.launch {
            try {
                if (target == SearchMode.ALBUMS) {
                    albums = repo.albumSearch(term)
                    results = emptyList()
                    artists = emptyList()
                    if (albums.isEmpty()) error = "Альбомы не нашлись"
                } else if (target == SearchMode.ARTISTS) {
                    artists = repo.artistSearch(term)
                    results = emptyList()
                    albums = emptyList()
                    if (artists.isEmpty()) error = "Артисты не нашлись"
                } else {
                    results = repo.search(term, songsOnly = true)
                    albums = emptyList()
                    artists = emptyList()
                    if (results.isEmpty()) error = "Ничего не нашлось"
                }
            } catch (e: Exception) {
                error = e.message ?: "Ошибка поиска"
                results = emptyList()
                albums = emptyList()
                artists = emptyList()
            } finally {
                busy = false
            }
        }
    }

    fun clear() {
        query = ""
        results = emptyList()
        albums = emptyList()
        artists = emptyList()
        error = null
    }

    Column(Modifier.fillMaxSize()) {
        Column(Modifier.padding(start = 22.dp, end = 22.dp, bottom = 12.dp)) {
            Text(
                "Поиск",
                color = TextMain,
                fontSize = 25.sp,
                fontWeight = FontWeight.SemiBold,
                letterSpacing = (-0.3).sp
            )
            Spacer(Modifier.height(2.dp))
            Text(
                "YouTube Music: треки, альбомы и исполнители",
                color = Muted,
                fontSize = 12.sp
            )
            Spacer(Modifier.height(14.dp))
            SearchField(
                query = query,
                focused = focused,
                placeholder = when (mode) {
                    SearchMode.ALBUMS -> "Название альбома или артист…"
                    SearchMode.ARTISTS -> "Имя артиста…"
                    SearchMode.TRACKS -> "Трек, исполнитель, альбом…"
                },
                onQueryChange = { query = it },
                onFocusChange = { focused = it },
                onClear = { clear() },
                onSearch = { run() }
            )
        }

        Row(
            Modifier
                .fillMaxWidth()
                .padding(start = 20.dp, end = 20.dp)
        ) {
            ModeTab("Треки", mode == SearchMode.TRACKS) {
                mode = SearchMode.TRACKS
                if (query.isNotBlank()) run(modeOverride = SearchMode.TRACKS)
            }
            ModeTab("Альбомы", mode == SearchMode.ALBUMS) {
                mode = SearchMode.ALBUMS
                if (query.isNotBlank()) run(modeOverride = SearchMode.ALBUMS)
            }
            ModeTab("Артисты", mode == SearchMode.ARTISTS) {
                mode = SearchMode.ARTISTS
                if (query.isNotBlank()) run(modeOverride = SearchMode.ARTISTS)
            }
        }
        Box(Modifier.fillMaxWidth().height(1.dp).background(Line))

        if (busy) {
            LinearProgressIndicator(
                modifier = Modifier.fillMaxWidth().padding(start = 22.dp, end = 22.dp, top = 2.dp).height(2.dp),
                color = Teal,
                trackColor = Color.Transparent
            )
        }

        if (error != null && !busy) {
            SearchEmpty("Нет результатов", error ?: "", suggestions = null, onSuggestion = {})
        } else if (results.isEmpty() && albums.isEmpty() && artists.isEmpty() && !busy) {
            val suggestions = when (mode) {
                SearchMode.ALBUMS -> listOf("Molchat Doma", "Tame Impala", "Radiohead")
                SearchMode.ARTISTS -> listOf("Molchat Doma", "Tame Impala", "Кино")
                SearchMode.TRACKS -> listOf("Molchat Doma", "Tame Impala", "phonk")
            }
            SearchEmpty(
                title = when (mode) {
                    SearchMode.ALBUMS -> "Найди альбом"
                    SearchMode.ARTISTS -> "Найди артиста"
                    SearchMode.TRACKS -> "Найди свой трек"
                },
                text = when (mode) {
                    SearchMode.ALBUMS -> "Альбомы можно сохранять в библиотеку."
                    SearchMode.ARTISTS -> "Треки и альбомы артиста в одном месте."
                    SearchMode.TRACKS -> "Поиск идёт по YouTube через NewPipe."
                },
                suggestions = suggestions,
                onSuggestion = { term -> query = term; run(term) }
            )
        } else if (mode == SearchMode.ALBUMS) {
            SearchResultHead("Альбомы", albums.size)
            LazyVerticalGrid(
                columns = GridCells.Fixed(2),
                modifier = Modifier.weight(1f),
                contentPadding = PaddingValues(start = 18.dp, end = 18.dp, bottom = 20.dp),
                horizontalArrangement = Arrangement.spacedBy(16.dp),
                verticalArrangement = Arrangement.spacedBy(18.dp)
            ) {
                gridItems(albums, key = { it.url }) { album ->
                    AlbumSearchCard(album = album, onOpen = { onOpenAlbum(album) })
                }
            }
        } else if (mode == SearchMode.ARTISTS) {
            SearchResultHead("Артисты", artists.size)
            LazyColumn(
                modifier = Modifier.weight(1f),
                contentPadding = PaddingValues(start = 10.dp, end = 8.dp, bottom = 20.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp)
            ) {
                items(artists, key = { it.url }) { artist ->
                    ArtistSearchRow(artist = artist, onOpen = { onOpenArtist(artist) })
                }
            }
        } else {
            SearchResultHead("Треки", results.size)
            LazyColumn(
                modifier = Modifier.weight(1f),
                contentPadding = PaddingValues(start = 10.dp, end = 8.dp, bottom = 20.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp)
            ) {
                itemsIndexed(results, key = { _, track -> track.key }) { index, track ->
                    TrackRow(
                        track = track,
                        liked = likedKeys.contains(track.key),
                        downloaded = downloads.containsKey(track.key),
                        downloading = downloading.contains(track.key),
                        active = activeKey == track.key,
                        index = index + 1,
                        onPlay = { onPlay(track, results) },
                        onLike = { onLike(track) },
                        onDownload = { onDownload(track) },
                        onAddToPlaylist = { onAddToPlaylist(track) }
                    )
                }
            }
        }
    }
}

@Composable
private fun SearchField(
    query: String,
    focused: Boolean,
    placeholder: String,
    onQueryChange: (String) -> Unit,
    onFocusChange: (Boolean) -> Unit,
    onClear: () -> Unit,
    onSearch: () -> Unit
) {
    BasicTextField(
        value = query,
        onValueChange = onQueryChange,
        singleLine = true,
        textStyle = TextStyle(color = TextMain, fontSize = 13.5.sp),
        cursorBrush = SolidColor(Teal),
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
        keyboardActions = KeyboardActions(onSearch = { onSearch() }),
        modifier = Modifier
            .fillMaxWidth()
            .height(46.dp)
            .onFocusChanged { onFocusChange(it.isFocused) },
        decorationBox = { inner ->
            Row(
                Modifier
                    .fillMaxSize()
                    .clip(RoundedCornerShape(12.dp))
                    .background(Color.White.copy(alpha = 0.04f))
                    .border(
                        1.dp,
                        if (focused) Teal.copy(alpha = 0.55f) else Line,
                        RoundedCornerShape(12.dp)
                    )
                    .padding(start = 12.dp, end = 5.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(
                    Icons.Rounded.Search,
                    contentDescription = null,
                    tint = Muted,
                    modifier = Modifier.size(18.dp)
                )
                Spacer(Modifier.width(9.dp))
                Box(Modifier.weight(1f)) {
                    if (query.isEmpty()) {
                        Text(placeholder, color = Muted, fontSize = 13.sp, maxLines = 1)
                    }
                    inner()
                }
                if (query.isNotEmpty()) {
                    Box(
                        Modifier
                            .size(30.dp)
                            .clip(CircleShape)
                            .clickable(onClick = onClear),
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            Icons.Rounded.Close,
                            contentDescription = "Очистить",
                            tint = Muted,
                            modifier = Modifier.size(15.dp)
                        )
                    }
                }
            }
        }
    )
}

@Composable
private fun ModeTab(label: String, selected: Boolean, onClick: () -> Unit) {
    Column(
        Modifier
            .clickable(onClick = onClick)
            .padding(top = 9.dp, bottom = 10.dp, end = 22.dp)
            .width(IntrinsicSize.Max)
    ) {
        Text(
            label,
            color = if (selected) TextMain else Muted,
            fontSize = 12.5.sp,
            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal
        )
        Spacer(Modifier.height(4.dp))
        Box(
            Modifier
                .fillMaxWidth()
                .height(2.dp)
                .then(
                    if (selected) {
                        Modifier.background(Brush.horizontalGradient(listOf(Teal, Indigo)))
                    } else Modifier
                )
        )
    }
}

@Composable
private fun SearchResultHead(label: String, count: Int) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(start = 22.dp, end = 22.dp, top = 16.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(label, color = TextMain, fontSize = 15.5.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.1).sp)
        Spacer(Modifier.width(8.dp))
        Text(count.toString(), color = Muted, fontSize = 10.5.sp)
    }
}

@Composable
private fun SearchEmpty(
    title: String,
    text: String,
    suggestions: List<String>?,
    onSuggestion: (String) -> Unit
) {
    Column(
        Modifier.fillMaxWidth().padding(horizontal = 28.dp, vertical = 42.dp),
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
        if (suggestions != null) {
            Spacer(Modifier.height(16.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                suggestions.forEach { term ->
                    Box(
                        Modifier
                            .clip(RoundedCornerShape(99.dp))
                            .background(Color.White.copy(alpha = 0.045f))
                            .border(1.dp, Line, RoundedCornerShape(99.dp))
                            .clickable { onSuggestion(term) }
                            .padding(horizontal = 11.dp, vertical = 6.dp)
                    ) {
                        Text(term, color = TextDim, fontSize = 11.sp, maxLines = 1)
                    }
                }
            }
        }
    }
}

@Composable
private fun AlbumSearchCard(album: AlbumRef, onOpen: () -> Unit) {
    val shape = RoundedCornerShape(12.dp)
    Column(Modifier.fillMaxWidth().clickable(onClick = onOpen)) {
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
            if (album.trackCount > 0) "${album.artist} · ${album.trackCount} ${albumWord(album.trackCount)}"
            else album.artist,
            color = Muted,
            fontSize = 10.5.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
    }
}

@Composable
private fun AlbumSearchRow(album: AlbumRef, onOpen: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .clickable(onClick = onOpen)
            .padding(start = 12.dp, end = 10.dp, top = 7.dp, bottom = 7.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        AsyncImage(
            model = album.thumbnail,
            contentDescription = null,
            contentScale = ContentScale.Crop,
            modifier = Modifier
                .size(52.dp)
                .clip(RoundedCornerShape(9.dp))
                .background(Surface2)
                .border(1.dp, Line, RoundedCornerShape(9.dp))
        )
        Spacer(Modifier.width(11.dp))
        Column(Modifier.weight(1f)) {
            Text(
                album.title,
                color = TextMain,
                fontSize = 13.5.sp,
                fontWeight = FontWeight.Medium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            Spacer(Modifier.height(2.dp))
            Text(
                if (album.trackCount > 0) "${album.artist} · ${album.trackCount} ${albumWord(album.trackCount)}"
                else album.artist,
                color = Muted,
                fontSize = 11.5.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
        Text("Открыть", color = Teal, fontSize = 10.5.sp, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun ArtistSearchRow(artist: ArtistRef, onOpen: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .clickable(onClick = onOpen)
            .padding(start = 12.dp, end = 10.dp, top = 7.dp, bottom = 7.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        AsyncImage(
            model = artist.avatar,
            contentDescription = null,
            contentScale = ContentScale.Crop,
            modifier = Modifier
                .size(50.dp)
                .clip(CircleShape)
                .background(Surface2)
                .border(1.dp, Line, CircleShape)
        )
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(
                artist.name,
                color = TextMain,
                fontSize = 13.5.sp,
                fontWeight = FontWeight.Medium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            Spacer(Modifier.height(2.dp))
            Text("Артист", color = Muted, fontSize = 11.5.sp)
        }
        Text("Открыть", color = Teal, fontSize = 10.5.sp, fontWeight = FontWeight.SemiBold)
    }
}

private fun albumWord(n: Long): String {
    val mod100 = n % 100
    val mod10 = n % 10
    return when {
        mod100 in 11..14 -> "треков"
        mod10 == 1L -> "трек"
        mod10 in 2..4 -> "трека"
        else -> "треков"
    }
}
