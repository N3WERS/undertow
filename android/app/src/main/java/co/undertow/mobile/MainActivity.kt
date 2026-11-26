package co.undertow.mobile

import android.Manifest
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Home
import androidx.compose.material.icons.rounded.LibraryMusic
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Waves
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.view.WindowCompat
import androidx.compose.runtime.DisposableEffect
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.UUID
import kotlin.math.max

class MainActivity : ComponentActivity() {
    private lateinit var player: ExoPlayer
    private lateinit var repo: MusicRepository
    private lateinit var store: LibraryStore
    private lateinit var downloader: AudioDownloader
    private var controllerFuture: com.google.common.util.concurrent.ListenableFuture<MediaController>? = null

    private val notificationPermission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) {}

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        WindowCompat.getInsetsController(window, window.decorView).isAppearanceLightStatusBars = false
        repo = MusicRepository()
        store = LibraryStore(this)
        downloader = AudioDownloader()
        player = Playback.player(this)
        startService(Intent(this, PlaybackService::class.java))
        val token = SessionToken(this, ComponentName(this, PlaybackService::class.java))
        controllerFuture = MediaController.Builder(this, token).buildAsync()
        controllerFuture?.addListener({ runCatching { controllerFuture?.get() } }, { r -> runOnUiThread(r) })
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
        setContent {
            UndertowTheme {
                UndertowApp(repo, store, downloader, player)
            }
        }
    }

}

@Composable
fun UndertowApp(
    repo: MusicRepository,
    store: LibraryStore,
    downloader: AudioDownloader,
    player: ExoPlayer
) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var tab by remember { mutableIntStateOf(0) }
    var likes by remember { mutableStateOf(store.loadLikes()) }
    var downloads by remember { mutableStateOf(store.loadDownloads()) }
    var downloadedTracks by remember { mutableStateOf(store.loadDownloadTracks()) }
    var savedAlbums by remember { mutableStateOf(store.loadAlbums()) }
    var history by remember { mutableStateOf(store.loadHistory()) }
    var albumRef by remember { mutableStateOf<AlbumRef?>(null) }
    var savedAlbumTarget by remember { mutableStateOf<AlbumItem?>(null) }
    var artistRef by remember { mutableStateOf<ArtistRef?>(null) }
    var playlists by remember { mutableStateOf(store.loadPlaylists()) }
    var playlistTarget by remember { mutableStateOf<String?>(null) }
    var pendingTrack by remember { mutableStateOf<TrackItem?>(null) }
    var showLikesList by remember { mutableStateOf(false) }
    var showAllPlaylists by remember { mutableStateOf(false) }
    var showAllAlbums by remember { mutableStateOf(false) }
    var showDownloadsList by remember { mutableStateOf(false) }
    var showHistoryList by remember { mutableStateOf(false) }
    var showQueue by remember { mutableStateOf(false) }
    var showNowPlaying by remember { mutableStateOf(false) }
    var returnToNowPlaying by remember { mutableStateOf(false) }
    var repeatMode by remember { mutableIntStateOf(0) }
    var shuffle by remember { mutableStateOf(false) }
    var showSettings by remember { mutableStateOf(false) }
    var audioQuality by remember { mutableStateOf(store.loadAudioQuality()) }
    var streamQuality by remember { mutableStateOf<String?>(null) }
    var downloading by remember { mutableStateOf<Set<String>>(emptySet()) }
    var homeTracks by remember { mutableStateOf<List<TrackItem>>(emptyList()) }
    var trendingTracks by remember { mutableStateOf<List<TrackItem>>(emptyList()) }
    var chartTracks by remember { mutableStateOf<List<TrackItem>>(emptyList()) }
    var chartLoading by remember { mutableStateOf(true) }
    var chartError by remember { mutableStateOf<String?>(null) }
    var chartScope by remember { mutableStateOf("ru") }
    var showChartList by remember { mutableStateOf(false) }
    var homeLoading by remember { mutableStateOf(true) }
    var homeError by remember { mutableStateOf<String?>(null) }
    var flowTracks by remember { mutableStateOf<List<TrackItem>>(emptyList()) }
    var flowSeeds by remember { mutableStateOf<List<FlowSeed>>(emptyList()) }
    var flowLoading by remember { mutableStateOf(false) }
    var flowRefilling by remember { mutableStateOf(false) }
    var flowActive by remember { mutableStateOf(false) }
    var flowError by remember { mutableStateOf<String?>(null) }
    val flowEngine = remember { FlowEngine(repo) }

    var queue by remember { mutableStateOf(Playback.queue) }
    var currentIndex by remember { mutableIntStateOf(Playback.index) }
    var playing by remember { mutableStateOf(false) }
    var resolving by remember { mutableStateOf(false) }
    var position by remember { mutableLongStateOf(0L) }
    var duration by remember { mutableLongStateOf(0L) }
    var error by remember { mutableStateOf<String?>(null) }
    val current = queue.getOrNull(currentIndex)
    val likedKeys = likes.map { it.key }.toSet()

    fun saveAlbum(album: AlbumItem) {
        savedAlbums = (listOf(album) + savedAlbums.filterNot { it.url == album.url }).take(100)
        store.saveAlbums(savedAlbums)
    }

    fun removeAlbum(album: AlbumItem) {
        savedAlbums = savedAlbums.filterNot { it.url == album.url }
        store.saveAlbums(savedAlbums)
    }

    fun clearHistory() {
        history = store.clearHistory()
    }

    fun setQuality(quality: AudioQuality) {
        audioQuality = quality
        store.saveAudioQuality(quality)
    }

    fun createPlaylist(name: String): PlaylistItem {
        val playlist = PlaylistItem(UUID.randomUUID().toString(), name, emptyList(), System.currentTimeMillis())
        playlists = listOf(playlist) + playlists
        store.savePlaylists(playlists)
        return playlist
    }

    fun addToPlaylist(playlistId: String, track: TrackItem) {
        playlists = playlists.map { playlist ->
            if (playlist.id == playlistId && playlist.tracks.none { it.key == track.key }) {
                playlist.copy(tracks = playlist.tracks + track)
            } else playlist
        }
        store.savePlaylists(playlists)
    }

    fun removeFromPlaylist(playlistId: String, track: TrackItem) {
        playlists = playlists.map { playlist ->
            if (playlist.id == playlistId) playlist.copy(tracks = playlist.tracks.filterNot { it.key == track.key })
            else playlist
        }
        store.savePlaylists(playlists)
    }

    fun renamePlaylist(playlistId: String, name: String) {
        playlists = playlists.map { if (it.id == playlistId) it.copy(name = name) else it }
        store.savePlaylists(playlists)
    }

    fun setPlaylistCover(playlistId: String, url: String?) {
        playlists = playlists.map { if (it.id == playlistId) it.copy(coverUrl = url) else it }
        store.savePlaylists(playlists)
    }

    fun deletePlaylist(playlistId: String) {
        playlists = playlists.filterNot { it.id == playlistId }
        store.savePlaylists(playlists)
        if (playlistTarget == playlistId) playlistTarget = null
    }

    fun toggleLike(track: TrackItem) {
        likes = if (likes.any { it.key == track.key }) likes.filterNot { it.key == track.key }
        else listOf(track) + likes
        store.saveLikes(likes)
    }

    fun download(track: TrackItem) {
        if (downloading.contains(track.key)) return
        if (downloads.containsKey(track.key)) {
            downloads[track.key]?.delete()
            downloads = downloads - track.key
            downloadedTracks = downloadedTracks.filterNot { it.key == track.key }
            store.saveDownloads(downloads)
            store.saveDownloadTracks(downloadedTracks)
            return
        }
        downloading = downloading + track.key
        error = null
        scope.launch {
            try {
                val src = repo.audioSource(track)
                val file = store.fileFor(track, src.ext)
                downloader.download(src.url, file)
                downloads = downloads + (track.key to file)
                downloadedTracks = listOf(track) + downloadedTracks.filterNot { it.key == track.key }
                store.saveDownloads(downloads)
                store.saveDownloadTracks(downloadedTracks)
            } catch (e: Exception) {
                error = e.message ?: "Не удалось скачать трек"
            } finally {
                downloading = downloading - track.key
            }
        }
    }

    fun playAt(index: Int, list: List<TrackItem>, fromFlow: Boolean = false) {
        val track = list.getOrNull(index) ?: return
        flowActive = fromFlow
        queue = list
        currentIndex = index
        Playback.queue = list
        Playback.index = index
        history = store.recordPlay(track)
        resolving = true
        runCatching { context.startService(Intent(context, PlaybackService::class.java)) }
        error = null
        scope.launch {
            try {
                val local = downloads[track.key]
                val source = if (local != null && local.exists()) null else repo.audioSource(track, audioQuality)
                streamQuality = if (source?.bitrateKbps != null && source.bitrateKbps > 0) "${source.bitrateKbps} kbps" else null
                val uri = if (local != null && local.exists()) Uri.fromFile(local)
                else Uri.parse(source?.url ?: throw IllegalStateException("Нет аудиопотока"))
                val metadata = MediaMetadata.Builder()
                    .setTitle(track.title)
                    .setArtist(track.artist)
                    .apply { track.thumbnail?.let { setArtworkUri(Uri.parse(it)) } }
                    .build()
                withContext(Dispatchers.Main) {
                    player.setMediaItem(MediaItem.Builder().setUri(uri).setMediaMetadata(metadata).build())
                    player.prepare()
                    player.playWhenReady = true
                }
            } catch (e: Exception) {
                error = e.message ?: "Не удалось получить звук"
            } finally {
                resolving = false
            }
        }
    }

    fun stopPlayback() {
        player.stop()
        player.clearMediaItems()
        queue = emptyList()
        currentIndex = -1
        Playback.queue = emptyList()
        Playback.index = -1
        resolving = false
    }

    fun removeFromQueue(index: Int) {
        if (index !in queue.indices) return
        val wasCurrent = index == currentIndex
        val currentKey = queue.getOrNull(currentIndex)?.key
        val next = queue.toMutableList().also { it.removeAt(index) }
        if (next.isEmpty()) {
            stopPlayback()
            return
        }
        if (wasCurrent) {
            val target = index.coerceAtMost(next.lastIndex)
            queue = next
            currentIndex = target
            Playback.queue = next
            Playback.index = target
            playAt(target, next)
        } else {
            queue = next
            currentIndex = next.indexOfFirst { it.key == currentKey }
            Playback.queue = next
            Playback.index = currentIndex
        }
    }

    fun moveInQueue(from: Int, to: Int) {
        if (from !in queue.indices || to !in queue.indices || from == to) return
        val currentKey = queue.getOrNull(currentIndex)?.key
        val next = queue.toMutableList()
        val item = next.removeAt(from)
        next.add(to, item)
        queue = next
        currentIndex = if (currentKey == null) -1 else next.indexOfFirst { it.key == currentKey }
        Playback.queue = next
        Playback.index = currentIndex
    }

    BackHandler(
        enabled = showSettings || showQueue || showNowPlaying || showLikesList ||
            showAllPlaylists || showAllAlbums || showDownloadsList || showHistoryList || showChartList ||
            albumRef != null || savedAlbumTarget != null || artistRef != null || playlistTarget != null
    ) {
        when {
            showNowPlaying -> showNowPlaying = false
            showSettings -> showSettings = false
            showQueue -> {
                showQueue = false
                if (returnToNowPlaying) {
                    showNowPlaying = true
                    returnToNowPlaying = false
                }
            }
            showLikesList -> showLikesList = false
            showAllPlaylists -> showAllPlaylists = false
            showAllAlbums -> showAllAlbums = false
            showDownloadsList -> showDownloadsList = false
            showHistoryList -> showHistoryList = false
            showChartList -> showChartList = false
            albumRef != null -> albumRef = null
            savedAlbumTarget != null -> savedAlbumTarget = null
            artistRef != null -> artistRef = null
            playlistTarget != null -> playlistTarget = null
        }
    }

    SideEffect {
        Playback.onSkip = { delta ->
            if (queue.isNotEmpty() && currentIndex >= 0) {
                val target = currentIndex + delta
                if (target in queue.indices) {
                    playAt(target, queue, fromFlow = flowActive)
                } else if (repeatMode > 0) {
                    playAt(if (delta > 0) 0 else queue.lastIndex, queue, fromFlow = flowActive)
                }
            }
        }
    }
    DisposableEffect(Unit) {
        onDispose { Playback.onSkip = null }
    }

    LaunchedEffect(Unit) {
        homeLoading = true
        homeError = null
        try {
            val found = repo.search("новинки музыки 2026", songsOnly = true)
            val songs = found.filter { it.duration in 30..900 }
            homeTracks = (songs.ifEmpty { found }).take(18)
            if (homeTracks.isEmpty()) homeError = "Новинки не загрузились"
        } catch (e: Exception) {
            homeError = e.message ?: "Нет сети"
        } finally {
            homeLoading = false
        }
    }

    LaunchedEffect(chartScope) {
        chartLoading = true
        chartError = null
        try {
            chartTracks = repo.chart(chartScope)
        } catch (e: Exception) {
            chartTracks = emptyList()
            chartError = e.message ?: "Чарт не загрузился"
        } finally {
            chartLoading = false
        }
    }

    LaunchedEffect(Unit) {
        try {
            val found = repo.search("популярные песни 2026", songsOnly = true)
            val songs = found.filter { it.duration in 30..900 }
            trendingTracks = (songs.ifEmpty { found }).take(18)
        } catch (_: Exception) {
            trendingTracks = emptyList()
        }
    }

    fun skipBy(delta: Int) {
        if (queue.isEmpty() || currentIndex < 0) return
        val target = currentIndex + delta
        if (target in queue.indices) {
            playAt(target, queue, fromFlow = flowActive)
        } else if (repeatMode > 0) {
            playAt(if (delta > 0) 0 else queue.lastIndex, queue, fromFlow = flowActive)
        }
    }

    fun toggleShuffle() {
        val enabled = !shuffle
        shuffle = enabled
        if (enabled && queue.size > 1) {
            val currentKey = queue.getOrNull(currentIndex)?.key
            val next = if (currentIndex in queue.indices) {
                queue.take(currentIndex + 1) + queue.drop(currentIndex + 1).shuffled()
            } else {
                queue.shuffled()
            }
            queue = next
            currentIndex = if (currentKey == null) -1 else next.indexOfFirst { it.key == currentKey }
            Playback.queue = next
            Playback.index = currentIndex
        }
    }

    fun cycleRepeat() {
        repeatMode = (repeatMode + 1) % 3
    }

    fun startFlow() {
        if (flowLoading) return
        flowLoading = true
        flowError = null
        scope.launch {
            try {
                val result = flowEngine.start(likes, history.map { it.track })
                flowSeeds = result.seeds
                flowTracks = result.tracks
                playAt(0, result.tracks)
                flowActive = true
            } catch (e: Exception) {
                flowError = e.message ?: "Не удалось собрать течение"
            } finally {
                flowLoading = false
            }
        }
    }

    LaunchedEffect(flowActive, currentIndex, queue.size) {
        if (!flowActive || flowRefilling || currentIndex < 0) return@LaunchedEffect
        if (queue.size - currentIndex > 10) return@LaunchedEffect
        flowRefilling = true
        try {
            val more = flowEngine.more()
            if (more.isEmpty()) {
                flowActive = false
            } else {
                val have = queue.map { it.key }.toSet()
                val add = more.filter { it.key !in have }
                if (add.isNotEmpty()) {
                    queue = queue + add
                    Playback.queue = queue
                    flowTracks = flowTracks + add
                }
            }
        } catch (e: Exception) {
            flowError = e.message ?: "Поток не продолжился"
        } finally {
            flowRefilling = false
        }
    }

    DisposableEffect(player) {
        val listener = object : Player.Listener {
            override fun onPlayerError(e: PlaybackException) {
                error = e.message ?: "Ошибка воспроизведения"
                resolving = false
            }
        }
        player.addListener(listener)
        onDispose { player.removeListener(listener) }
    }

    LaunchedEffect(player, currentIndex, queue) {
        while (true) {
            playing = player.isPlaying
            position = max(0L, player.currentPosition)
            duration = max(0L, player.duration)
            if (player.playbackState == androidx.media3.common.Player.STATE_ENDED && currentIndex >= 0) {
                when {
                    repeatMode == 2 -> {
                        player.seekTo(0)
                        player.play()
                    }
                    currentIndex + 1 < queue.size -> {
                        playAt(currentIndex + 1, queue, fromFlow = flowActive)
                    }
                    repeatMode == 1 && queue.isNotEmpty() -> {
                        playAt(0, queue, fromFlow = flowActive)
                    }
                    else -> {
                        player.pause()
                        currentIndex = -1
                        Playback.index = -1
                    }
                }
            }
            delay(450)
        }
    }

    Box(Modifier.fillMaxSize().background(Bg).systemBarsPadding()) {
        UndertowBackdrop(Modifier.matchParentSize())
    Column(Modifier.fillMaxSize()) {
        Row(
            Modifier.fillMaxWidth().height(48.dp).padding(start = 16.dp, end = 6.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Image(
                painter = painterResource(R.drawable.app_icon),
                contentDescription = null,
                modifier = Modifier.size(24.dp).clip(RoundedCornerShape(7.dp))
            )
            Spacer(Modifier.width(8.dp))
            Row(verticalAlignment = Alignment.Bottom) {
                Text(
                    "Undertow",
                    color = TextMain,
                    fontSize = 15.sp,
                    fontWeight = FontWeight.SemiBold,
                    letterSpacing = 0.2.sp,
                    lineHeight = 17.sp
                )
                Spacer(Modifier.width(6.dp))
                Text(
                    "mobile",
                    color = Teal,
                    fontSize = 8.5.sp,
                    fontWeight = FontWeight.Medium,
                    letterSpacing = 1.1.sp,
                    lineHeight = 10.sp,
                    modifier = Modifier.padding(bottom = 1.dp)
                )
            }
            Spacer(Modifier.weight(1f))
            IconButton(onClick = { showSettings = true }) {
                Icon(Icons.Rounded.Settings, contentDescription = "Настройки", tint = Muted, modifier = Modifier.size(18.dp))
            }
        }
        Box(Modifier.fillMaxWidth().height(1.dp).background(Line))
        Spacer(Modifier.height(12.dp))

        if (error != null) {
            Text(
                error ?: "",
                color = Color(0xFFFF9A9A),
                fontSize = 11.5.sp,
                modifier = Modifier.padding(horizontal = 18.dp, vertical = 4.dp)
            )
        }

        Box(Modifier.weight(1f)) {
            if (showSettings) {
                SettingsScreen(
                    quality = audioQuality,
                    historyCount = history.size,
                    downloadsCount = downloads.size,
                    downloadsBytes = downloads.values.sumOf { it.length() },
                    onBack = { showSettings = false },
                    onQualityChange = ::setQuality,
                    onClearHistory = ::clearHistory
                )
                return@Box
            }
            if (showQueue) {
                QueueScreen(
                    queue = queue,
                    currentIndex = currentIndex,
                    playing = playing,
                    shuffle = shuffle,
                    repeatMode = repeatMode,
                    onBack = {
                        showQueue = false
                        if (returnToNowPlaying) {
                            showNowPlaying = true
                            returnToNowPlaying = false
                        }
                    },
                    onPlayAt = { index -> playAt(index, queue) },
                    onRemove = ::removeFromQueue,
                    onMove = ::moveInQueue,
                    onToggleShuffle = ::toggleShuffle,
                    onCycleRepeat = ::cycleRepeat
                )
                return@Box
            }
            if (showChartList) {
                LibraryTrackListScreen(
                    title = "Топ 100",
                    tracks = chartTracks,
                    emptyTitle = "Чарт пока не загрузился",
                    emptyText = "Вернись на главную и попробуй ещё раз.",
                    downloads = downloads,
                    downloading = downloading,
                    likedKeys = likedKeys,
                    activeKey = current?.key,
                    onBack = { showChartList = false },
                    onPlay = { t, list -> playAt(list.indexOfFirst { it.key == t.key }.coerceAtLeast(0), list) },
                    onLike = ::toggleLike,
                    onDownload = ::download,
                    onAddToPlaylist = { pendingTrack = it }
                )
                return@Box
            }
            if (showLikesList) {
                LibraryTrackListScreen(
                    title = "Мне нравится",
                    tracks = likes,
                    emptyTitle = "Пока пусто",
                    emptyText = "Ставь сердечки на треках — они появятся здесь.",
                    downloads = downloads,
                    downloading = downloading,
                    likedKeys = likedKeys,
                    activeKey = current?.key,
                    onBack = { showLikesList = false },
                    onPlay = { t, list -> playAt(list.indexOfFirst { it.key == t.key }.coerceAtLeast(0), list) },
                    onLike = ::toggleLike,
                    onDownload = ::download,
                    onAddToPlaylist = { pendingTrack = it }
                )
                return@Box
            }
            if (showDownloadsList) {
                LibraryTrackListScreen(
                    title = "Скачано",
                    tracks = downloadedTracks.filter { downloads.containsKey(it.key) },
                    emptyTitle = "Пока ничего не скачано",
                    emptyText = "Скачивай треки кнопкой загрузки — они будут играть без сети.",
                    downloads = downloads,
                    downloading = downloading,
                    likedKeys = likedKeys,
                    activeKey = current?.key,
                    onBack = { showDownloadsList = false },
                    onPlay = { t, list -> playAt(list.indexOfFirst { it.key == t.key }.coerceAtLeast(0), list) },
                    onLike = ::toggleLike,
                    onDownload = ::download,
                    onAddToPlaylist = { pendingTrack = it }
                )
                return@Box
            }
            if (showHistoryList) {
                LibraryTrackListScreen(
                    title = "История",
                    tracks = history.map { it.track },
                    emptyTitle = "Ещё ничего не слушал",
                    emptyText = "История собирается сама: всё, что играло, попадает сюда.",
                    downloads = downloads,
                    downloading = downloading,
                    likedKeys = likedKeys,
                    activeKey = current?.key,
                    onBack = { showHistoryList = false },
                    onPlay = { t, list -> playAt(list.indexOfFirst { it.key == t.key }.coerceAtLeast(0), list) },
                    onLike = ::toggleLike,
                    onDownload = ::download,
                    onAddToPlaylist = { pendingTrack = it },
                    onClear = { clearHistory() }
                )
                return@Box
            }
            if (showAllPlaylists) {
                AllPlaylistsScreen(
                    playlists = playlists,
                    onBack = { showAllPlaylists = false },
                    onOpen = { playlist ->
                        showAllPlaylists = false
                        playlistTarget = playlist.id
                    },
                    onCreate = { name ->
                        showAllPlaylists = false
                        playlistTarget = createPlaylist(name).id
                    }
                )
                return@Box
            }
            if (showAllAlbums) {
                AllAlbumsScreen(
                    albums = savedAlbums,
                    onBack = { showAllAlbums = false },
                    onOpen = { album ->
                        showAllAlbums = false
                        savedAlbumTarget = album
                    }
                )
                return@Box
            }
            val target = albumRef
            val savedTarget = savedAlbumTarget
            val artistTarget = artistRef
            val playlist = playlists.firstOrNull { it.id == playlistTarget }
            if (target != null) {
                AlbumScreen(
                    ref = target,
                    repo = repo,
                    saved = savedAlbums.any { it.url == target.url },
                    downloads = downloads,
                    downloading = downloading,
                    likedKeys = likedKeys,
                    activeKey = current?.key,
                    onBack = { albumRef = null },
                    onSave = ::saveAlbum,
                    onPlay = { t, list -> playAt(list.indexOfFirst { it.key == t.key }.coerceAtLeast(0), list) },
                    onLike = ::toggleLike,
                    onDownload = ::download,
                    onAddToPlaylist = { pendingTrack = it }
                )
            } else if (savedTarget != null) {
                SavedAlbumScreen(
                    album = savedTarget,
                    downloads = downloads,
                    downloading = downloading,
                    likedKeys = likedKeys,
                    activeKey = current?.key,
                    onBack = { savedAlbumTarget = null },
                    onPlay = { t, list -> playAt(list.indexOfFirst { it.key == t.key }.coerceAtLeast(0), list) },
                    onLike = ::toggleLike,
                    onDownload = ::download,
                    onAddToPlaylist = { pendingTrack = it }
                )
            } else if (artistTarget != null) {
                ArtistScreen(
                    ref = artistTarget,
                    repo = repo,
                    downloads = downloads,
                    downloading = downloading,
                    likedKeys = likedKeys,
                    activeKey = current?.key,
                    onBack = { artistRef = null },
                    onOpenAlbum = { albumRef = it },
                    onPlay = { t, list -> playAt(list.indexOfFirst { it.key == t.key }.coerceAtLeast(0), list) },
                    onLike = ::toggleLike,
                    onDownload = ::download,
                    onAddToPlaylist = { pendingTrack = it }
                )
            } else if (playlist != null) {
                PlaylistScreen(
                    playlist = playlist,
                    downloads = downloads,
                    downloading = downloading,
                    likedKeys = likedKeys,
                    activeKey = current?.key,
                    onBack = { playlistTarget = null },
                    onPlay = { t, list -> playAt(list.indexOfFirst { it.key == t.key }.coerceAtLeast(0), list) },
                    onLike = ::toggleLike,
                    onDownload = ::download,
                    onRemoveTrack = { removeFromPlaylist(playlist.id, it) },
                    onRename = { name -> renamePlaylist(playlist.id, name) },
                    onCoverChange = { url -> setPlaylistCover(playlist.id, url) },
                    onDelete = { deletePlaylist(playlist.id) }
                )
            } else when (tab) {
                0 -> HomeScreen(
                    newTracks = homeTracks,
                    trending = trendingTracks,
                    history = history,
                    chartTracks = chartTracks,
                    chartLoading = chartLoading,
                    chartError = chartError,
                    chartScope = chartScope,
                    onChartScope = { chartScope = it },
                    onOpenChart = { showChartList = true },
                    loading = homeLoading,
                    downloads = downloads,
                    downloading = downloading,
                    likedKeys = likedKeys,
                    activeKey = current?.key,
                    onPlay = { t, list -> playAt(list.indexOfFirst { it.key == t.key }.coerceAtLeast(0), list) },
                    onLike = ::toggleLike,
                    onDownload = ::download
                )
                1 -> FlowScreen(
                    tracks = if (flowActive) queue else flowTracks,
                    seeds = flowSeeds,
                    loading = flowLoading,
                    refilling = flowRefilling,
                    error = flowError,
                    downloads = downloads,
                    downloading = downloading,
                    likedKeys = likedKeys,
                    activeKey = current?.key,
                    onStart = ::startFlow,
                    onPlay = { t, list ->
                        playAt(
                            list.indexOfFirst { it.key == t.key }.coerceAtLeast(0),
                            list,
                            fromFlow = true
                        )
                    },
                    onLike = ::toggleLike,
                    onDownload = ::download
                )
                2 -> SearchScreen(
                    repo = repo,
                    likedKeys = likedKeys,
                    downloads = downloads,
                    downloading = downloading,
                    activeKey = current?.key,
                    onPlay = { t, list -> playAt(list.indexOfFirst { it.key == t.key }.coerceAtLeast(0), list) },
                    onLike = ::toggleLike,
                    onDownload = ::download,
                    onAddToPlaylist = { pendingTrack = it },
                    onOpenAlbum = { albumRef = it },
                    onOpenArtist = { artistRef = it }
                )
                3 -> LibraryScreen(
                    likes = likes,
                    albums = savedAlbums,
                    history = history,
                    playlists = playlists,
                    downloadedTracks = downloadedTracks,
                    downloads = downloads,
                    downloading = downloading,
                    likedKeys = likedKeys,
                    activeKey = current?.key,
                    onPlay = { t, list -> playAt(list.indexOfFirst { it.key == t.key }.coerceAtLeast(0), list) },
                    onLike = ::toggleLike,
                    onDownload = ::download,
                    onAddToPlaylist = { pendingTrack = it },
                    onOpenAlbum = { savedAlbumTarget = it },
                    onOpenPlaylist = { playlistTarget = it.id },
                    onOpenLikes = { showLikesList = true },
                    onOpenPlaylists = { showAllPlaylists = true },
                    onOpenAlbums = { showAllAlbums = true },
                    onOpenDownloads = { showDownloadsList = true },
                    onOpenHistory = { showHistoryList = true }
                )
            }
        }

        current?.let { track ->
            PlayerBar(
                track = track,
                playing = playing,
                resolving = resolving,
                liked = likedKeys.contains(track.key),
                downloaded = downloads.containsKey(track.key),
                downloading = downloading.contains(track.key),
                position = position,
                duration = duration,
                onToggle = { if (player.isPlaying) player.pause() else player.play() },
                onLike = { toggleLike(track) },
                onDownload = { download(track) },
                onOpen = { showNowPlaying = true },
                onSeek = { player.seekTo(it) }
            )
        }

        Box(
            Modifier
                .fillMaxWidth()
                .padding(start = 12.dp, end = 12.dp, top = 4.dp, bottom = 6.dp)
        ) {
            Box(
                Modifier
                    .fillMaxWidth()
                    .shadow(
                        elevation = 16.dp,
                        shape = RoundedCornerShape(18.dp),
                        ambientColor = Color.Black,
                        spotColor = Color.Black
                    )
                    .clip(RoundedCornerShape(18.dp))
                    .background(
                        Brush.verticalGradient(
                            listOf(
                                Color(0xF2131D28),
                                Color(0xFA0A1119),
                                Color(0xFF070B10)
                            )
                        )
                    )
                    .border(1.dp, Color.White.copy(alpha = 0.075f), RoundedCornerShape(18.dp))
            ) {
                Box(
                    Modifier
                        .align(Alignment.TopCenter)
                        .fillMaxWidth()
                        .height(1.dp)
                        .background(
                            Brush.horizontalGradient(
                                listOf(
                                    Teal.copy(alpha = 0.22f),
                                    Indigo.copy(alpha = 0.14f),
                                    Color.Transparent
                                )
                            )
                        )
                )
                Row(
                    Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 5.dp, vertical = 5.dp),
                    horizontalArrangement = Arrangement.spacedBy(2.dp)
                ) {
                    BottomTabItem(
                        label = "Главная",
                    icon = Icons.Rounded.Home,
                    selected = tab == 0,
                    modifier = Modifier.weight(1f),
                    onClick = {
                        tab = 0; albumRef = null; savedAlbumTarget = null
                        artistRef = null; playlistTarget = null; showQueue = false; showLikesList = false; showAllPlaylists = false; showAllAlbums = false; showDownloadsList = false; showHistoryList = false; showChartList = false
                    }
                )
                BottomTabItem(
                    label = "Течение",
                    icon = Icons.Rounded.Waves,
                    selected = tab == 1,
                    modifier = Modifier.weight(1f),
                    onClick = {
                        tab = 1; albumRef = null; savedAlbumTarget = null
                        artistRef = null; playlistTarget = null; showQueue = false; showLikesList = false; showAllPlaylists = false; showAllAlbums = false; showDownloadsList = false; showHistoryList = false; showChartList = false
                    }
                )
                BottomTabItem(
                    label = "Поиск",
                    icon = Icons.Rounded.Search,
                    selected = tab == 2,
                    modifier = Modifier.weight(1f),
                    onClick = {
                        tab = 2; albumRef = null; savedAlbumTarget = null
                        artistRef = null; playlistTarget = null; showQueue = false; showLikesList = false; showAllPlaylists = false; showAllAlbums = false; showDownloadsList = false; showHistoryList = false; showChartList = false
                    }
                )
                    BottomTabItem(
                        label = "Библиотека",
                        icon = Icons.Rounded.LibraryMusic,
                        selected = tab == 3,
                        modifier = Modifier.weight(1f),
                        onClick = {
                            tab = 3; albumRef = null; savedAlbumTarget = null
                            artistRef = null; playlistTarget = null; showQueue = false; showLikesList = false; showAllPlaylists = false; showAllAlbums = false; showDownloadsList = false; showHistoryList = false; showChartList = false
                        }
                    )
                }
            }
        }

    }

        val nowTrack = current
        AnimatedVisibility(
            visible = showNowPlaying && nowTrack != null,
            enter = slideInVertically(
                animationSpec = tween(360),
                initialOffsetY = { it }
            ) + fadeIn(tween(220)) + scaleIn(
                animationSpec = tween(360),
                initialScale = 0.97f
            ),
            exit = slideOutVertically(
                animationSpec = tween(260),
                targetOffsetY = { it }
            ) + fadeOut(tween(180)) + scaleOut(
                animationSpec = tween(260),
                targetScale = 0.98f
            )
        ) {
            nowTrack?.let { track ->
                NowPlayingScreen(
                    track = track,
                    playing = playing,
                    resolving = resolving,
                    liked = likedKeys.contains(track.key),
                    downloaded = downloads.containsKey(track.key),
                    downloading = downloading.contains(track.key),
                    position = position,
                    duration = duration,
                    quality = streamQuality,
                    repeatMode = repeatMode,
                    shuffle = shuffle,
                    onClose = { showNowPlaying = false },
                    onToggle = { if (player.isPlaying) player.pause() else player.play() },
                    onPrev = { skipBy(-1) },
                    onNext = { skipBy(1) },
                    onSeek = { player.seekTo(it) },
                    onLike = { toggleLike(track) },
                    onDownload = { download(track) },
                    onAddToPlaylist = { pendingTrack = track },
                    onOpenQueue = {
                        showNowPlaying = false
                        returnToNowPlaying = true
                        showQueue = true
                    },
                    onToggleShuffle = ::toggleShuffle,
                    onCycleRepeat = ::cycleRepeat
                )
            }
        }

        pendingTrack?.let { track ->
            AddToPlaylistDialog(
                track = track,
                playlists = playlists,
                onDismiss = { pendingTrack = null },
                onPick = { playlist ->
                    addToPlaylist(playlist.id, track)
                    pendingTrack = null
                },
                onCreate = { name ->
                    val playlist = createPlaylist(name)
                    addToPlaylist(playlist.id, track)
                    pendingTrack = null
                }
            )
        }
    }
}

@Composable
private fun BottomTabItem(
    label: String,
    icon: ImageVector,
    selected: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit
) {
    val shape = RoundedCornerShape(10.dp)
    Box(
        modifier
            .height(46.dp)
            .clip(shape)
            .then(
                if (selected) {
                    Modifier
                        .background(
                            Brush.horizontalGradient(
                                listOf(Teal.copy(alpha = 0.14f), Indigo.copy(alpha = 0.07f))
                            )
                        )
                        .border(1.dp, Teal.copy(alpha = 0.14f), shape)
                } else Modifier
            )
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center
    ) {
        Icon(
            icon,
            contentDescription = label,
            tint = if (selected) Teal else Muted,
            modifier = Modifier.size(26.dp)
        )
    }
}

