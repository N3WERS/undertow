package co.undertow.mobile

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File

class AudioDownloader {
    private val client = OkHttpClient.Builder().build()

    suspend fun download(url: String, destination: File): File = withContext(Dispatchers.IO) {
        destination.parentFile?.mkdirs()
        val tmp = File(destination.parentFile, destination.name + ".part")
        val request = Request.Builder()
            .url(url)
            .header("User-Agent", USER_AGENT)
            .header("Referer", "https://www.youtube.com/")
            .build()
        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) error("HTTP ${response.code}")
            val body = response.body ?: error("Пустой ответ")
            tmp.outputStream().use { out -> body.byteStream().copyTo(out) }
        }
        if (destination.exists()) destination.delete()
        if (!tmp.renameTo(destination)) error("Не удалось сохранить файл")
        destination
    }

    companion object {
        private const val USER_AGENT =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:153.0) Gecko/20100101 Firefox/153.0"
    }
}
