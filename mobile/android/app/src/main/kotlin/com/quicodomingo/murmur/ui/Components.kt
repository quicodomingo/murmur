package com.quicodomingo.murmur.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.quicodomingo.murmur.R

val LocalPalette = staticCompositionLocalOf { MurmurPalette.acidLight }

/** The palette for the system's mode (the theme choice comes with Configuració). */
@Composable
fun MurmurTheme(content: @Composable () -> Unit) {
    val palette = if (isSystemInDarkTheme()) MurmurPalette.acidDark else MurmurPalette.acidLight
    CompositionLocalProvider(LocalPalette provides palette, content = content)
}

/** Times always with tabular figures, never a monospaced font (DESIGN.md). */
val Tabular = TextStyle(fontFeatureSettings = "tnum")

fun clock(seconds: Double): String {
    val s = seconds.toInt().coerceAtLeast(0)
    return "%02d:%02d:%02d".format(s / 3600, s / 60 % 60, s % 60)
}

fun minuteMark(seconds: Double): String {
    val s = seconds.toInt().coerceAtLeast(0)
    return if (s >= 3600) "%d:%02d:%02d".format(s / 3600, s / 60 % 60, s % 60) else "%d:%02d".format(s / 60, s % 60)
}

/** A speaker's label, with the desktop's colours: the user ("Tu") in the acid, others by number. */
@Composable
fun SpeakerChip(speaker: Int, name: String?, you: Boolean = false) {
    val c = LocalPalette.current
    val (tint, text) = when {
        you -> c.you to c.onYou
        else -> when (speaker % 4) {
            0 -> c.speaker1Tint to c.speaker1Text
            1 -> c.speaker2Tint to c.speaker2Text
            2 -> c.speaker3Tint to c.speaker3Text
            else -> c.speaker4Tint to c.speaker4Text
        }
    }
    Text(
        name ?: stringResource(R.string.rec_speaker, (speaker + 1).toString()),
        color = text, fontSize = 12.sp, fontWeight = FontWeight.SemiBold,
        modifier = Modifier.background(tint, RoundedCornerShape(6.dp)).padding(horizontal = 8.dp, vertical = 3.dp),
    )
}

/** "Important", next to a line said within a marked moment. */
@Composable
fun MarkChip() {
    val c = LocalPalette.current
    Row(
        Modifier.background(c.fillSubtle, RoundedCornerShape(6.dp)).padding(horizontal = 7.dp, vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Icon(painterResource(R.drawable.ic_flag), null, tint = c.textPrimary, modifier = Modifier.width(13.dp).height(13.dp))
        Text(stringResource(R.string.rec_important), color = c.textPrimary, fontSize = 12.sp, fontWeight = FontWeight.Medium)
    }
}

/** Three bars that follow the voice (the level, 0…1 after the square root, as on the iPhone). */
@Composable
fun Levels(level: Float, color: androidx.compose.ui.graphics.Color, height: Int = 16) {
    val v = kotlin.math.sqrt((level / 0.22f).coerceIn(0f, 1f))
    Row(horizontalArrangement = Arrangement.spacedBy(2.dp), verticalAlignment = Alignment.CenterVertically) {
        listOf(0.55f, 1f, 0.75f).forEach { k ->
            Box(Modifier.width(3.dp).height((height * (0.25f + 0.75f * v * k)).dp).background(color, RoundedCornerShape(2.dp)))
        }
    }
}
