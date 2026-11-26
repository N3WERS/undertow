package co.undertow.mobile

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ArrowBack
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.RadioButton
import androidx.compose.material3.RadioButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
fun SettingsScreen(
    quality: AudioQuality,
    historyCount: Int,
    downloadsCount: Int,
    downloadsBytes: Long,
    onBack: () -> Unit,
    onQualityChange: (AudioQuality) -> Unit,
    onClearHistory: () -> Unit
) {
    Column(Modifier.fillMaxSize()) {
        Row(
            Modifier.fillMaxWidth().padding(start = 8.dp, end = 16.dp, top = 2.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            IconButton(onClick = onBack) {
                Icon(Icons.Rounded.ArrowBack, contentDescription = "Назад", tint = TextMain)
            }
            Column {
                Text("Настройки", color = TextMain, fontSize = 18.sp, fontWeight = FontWeight.Bold)
                Text("Звук и данные", color = Muted, fontSize = 10.5.sp)
            }
        }

        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 32.dp)
        ) {
            item {
                SectionTitle("Качество звука")
                Column(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(14.dp))
                        .background(Surface)
                ) {
                    QualityRow(
                        title = "Авто",
                        hint = "Лучшее доступное качество",
                        selected = quality == AudioQuality.AUTO,
                        onClick = { onQualityChange(AudioQuality.AUTO) }
                    )
                    QualityRow(
                        title = "Высокое · ~160 kbps",
                        hint = "Максимум деталей, больше трафика",
                        selected = quality == AudioQuality.HIGH,
                        onClick = { onQualityChange(AudioQuality.HIGH) }
                    )
                    QualityRow(
                        title = "Среднее · ~96 kbps",
                        hint = "Баланс качества и трафика",
                        selected = quality == AudioQuality.MEDIUM,
                        onClick = { onQualityChange(AudioQuality.MEDIUM) }
                    )
                    QualityRow(
                        title = "Экономное · ~64 kbps",
                        hint = "Для слабой или мобильной сети",
                        selected = quality == AudioQuality.LOW,
                        onClick = { onQualityChange(AudioQuality.LOW) }
                    )
                }
                Text(
                    "Применяется со следующего трека. Скачивание всегда идёт в максимальном качестве.",
                    color = Muted,
                    fontSize = 11.sp,
                    lineHeight = 15.sp,
                    modifier = Modifier.padding(start = 4.dp, top = 8.dp, bottom = 20.dp)
                )
            }

            item {
                SectionTitle("Данные")
                InfoRow("Скачано треков", downloadsCount.toString())
                InfoRow("Занято", formatBytes(downloadsBytes))
                Spacer(Modifier.height(16.dp))
            }

            item {
                SectionTitle("Библиотека")
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(14.dp))
                        .background(Surface)
                        .padding(start = 14.dp, end = 6.dp, top = 8.dp, bottom = 8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column(Modifier.weight(1f)) {
                        Text("История прослушиваний", color = TextMain, fontSize = 13.sp, fontWeight = FontWeight.Medium)
                        Text("$historyCount записей", color = Muted, fontSize = 10.5.sp)
                    }
                    TextButton(onClick = onClearHistory, enabled = historyCount > 0) {
                        Text("Очистить", color = if (historyCount > 0) Color(0xFFFF9A9A) else Muted, fontSize = 12.sp)
                    }
                }
                Spacer(Modifier.height(20.dp))
            }

            item {
                SectionTitle("О приложении")
                InfoRow("Undertow mobile", "0.1.0")
                InfoRow("Автор", "N3WERS")
                InfoRow("Источник", "YouTube · NewPipe")
                Spacer(Modifier.height(14.dp))
                Text(
                    "MVP-клиент Undertow для Android. Пока без фонового сервиса и Android Auto.",
                    color = Muted,
                    fontSize = 11.sp,
                    lineHeight = 15.sp
                )
            }
        }
    }
}

@Composable
private fun SectionTitle(text: String) {
    Text(
        text.uppercase(),
        color = Teal,
        fontSize = 9.5.sp,
        fontWeight = FontWeight.Bold,
        letterSpacing = 1.3.sp,
        modifier = Modifier.padding(start = 4.dp, bottom = 7.dp)
    )
}

@Composable
private fun QualityRow(title: String, hint: String, selected: Boolean, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(start = 10.dp, end = 12.dp, top = 10.dp, bottom = 10.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        RadioButton(
            selected = selected,
            onClick = onClick,
            colors = RadioButtonDefaults.colors(selectedColor = Teal, unselectedColor = Muted)
        )
        Column(Modifier.weight(1f)) {
            Text(title, color = if (selected) Teal else TextMain, fontSize = 13.sp, fontWeight = FontWeight.Medium)
            Text(hint, color = Muted, fontSize = 10.5.sp)
        }
    }
}

@Composable
private fun InfoRow(label: String, value: String) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 14.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(label, color = Muted, fontSize = 12.sp, modifier = Modifier.weight(1f))
        Text(value, color = TextMain, fontSize = 12.sp, fontWeight = FontWeight.Medium)
    }
}

private fun formatBytes(bytes: Long): String {
    if (bytes <= 0) return "0 МБ"
    val mb = bytes / (1024.0 * 1024.0)
    return if (mb < 1) "${bytes / 1024} КБ" else "%.1f МБ".format(mb)
}
