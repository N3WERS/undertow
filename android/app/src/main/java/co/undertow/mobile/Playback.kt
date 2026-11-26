package co.undertow.mobile

import android.content.Context
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.exoplayer.ExoPlayer

/** Один ExoPlayer на процесс: его используют и экран, и foreground-сервис. */
object Playback {
    @Volatile
    private var instance: ExoPlayer? = null

    var queue: List<TrackItem> = emptyList()
    var index: Int = -1
    var onSkip: ((Int) -> Unit)? = null

    fun skip(delta: Int) {
        onSkip?.invoke(delta)
    }

    fun player(context: Context): ExoPlayer = synchronized(this) {
        instance ?: ExoPlayer.Builder(context.applicationContext).build().apply {
            setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(C.USAGE_MEDIA)
                    .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                    .build(),
                true
            )
            setHandleAudioBecomingNoisy(true)
            setWakeMode(C.WAKE_MODE_NETWORK)
            instance = this
        }
    }
}
