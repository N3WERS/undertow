package co.undertow.mobile

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color

val Bg = Color(0xFF070A0E)
val Surface = Color(0xFF0F1620)
val Surface2 = Color(0xFF141E2A)
val Surface3 = Color(0xFF1A2634)
val Line = Color(0xFF1B2531)
val LineStrong = Color(0xFF2A3644)
val Teal = Color(0xFF37D6CF)
val Indigo = Color(0xFF6F8CFF)
val Muted = Color(0xFF71839A)
val TextDim = Color(0xFF9AABC0)
val TextMain = Color(0xFFE8EEF6)
val Danger = Color(0xFFFF6B6B)

@Composable
fun UndertowTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = Teal,
            secondary = Indigo,
            background = Bg,
            surface = Surface,
            onBackground = TextMain,
            onSurface = TextMain,
            outline = Line
        ),
        content = content
    )
}

/**
 * Фон приложения как на desktop: тёмная база и едва заметные
 * зелёно-бирюзовые и фиолетовые радиальные блики по краям.
 */
@Composable
fun UndertowBackdrop(modifier: Modifier = Modifier) {
    Canvas(modifier.fillMaxSize()) {
        val w = size.width
        val h = size.height
        drawRect(
            brush = Brush.linearGradient(
                colors = listOf(Color(0xFF080F10), Color(0xFF080B11), Color(0xFF0A0B12)),
                start = Offset.Zero,
                end = Offset(w, h)
            )
        )

        fun glow(x: Float, y: Float, radius: Float, color: Color) {
            val center = Offset(w * x, h * y)
            val r = w * radius
            drawCircle(
                brush = Brush.radialGradient(
                    colorStops = arrayOf(
                        0f to color,
                        0.64f to Color.Transparent,
                        1f to Color.Transparent
                    ),
                    center = center,
                    radius = r
                ),
                radius = r,
                center = center
            )
        }

        glow(0.18f, -0.18f, 0.92f, Teal.copy(alpha = 0.060f))
        glow(0.30f, 0.46f, 0.82f, Teal.copy(alpha = 0.028f))
        glow(-0.08f, 1.02f, 0.86f, Color(0xFF34D399).copy(alpha = 0.038f))
        glow(1.04f, -0.06f, 0.94f, Color(0xFF8B5CF6).copy(alpha = 0.034f))
        glow(1.02f, 0.74f, 0.84f, Color(0xFF8B5CF6).copy(alpha = 0.026f))
        glow(0.96f, 1.08f, 0.84f, Indigo.copy(alpha = 0.028f))
    }
}
