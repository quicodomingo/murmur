package com.quicodomingo.murmur.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.TextButton
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardCapitalization
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

/** A mark in the notes (its own text), as the iPhone's flag chip: the acid as a fill, dark text on it. */
@Composable
fun FlagChip(label: String) {
    val c = LocalPalette.current
    Row(
        Modifier.background(c.accent, RoundedCornerShape(6.dp)).padding(horizontal = 7.dp, vertical = 3.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Icon(painterResource(R.drawable.ic_flag), null, tint = c.onAccent, modifier = Modifier.size(13.dp))
        Text(label, color = c.onAccent, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
    }
}

/** The iPhone's segmented control: a track with the chosen option raised on it. */
@Composable
fun <T> Segmented(options: List<Pair<T, String>>, selection: T, modifier: Modifier = Modifier, onSelect: (T) -> Unit) {
    val c = LocalPalette.current
    Row(modifier.fillMaxWidth().background(c.segmentedTrack, RoundedCornerShape(12.dp)).padding(3.dp)) {
        options.forEach { (value, label) ->
            val on = value == selection
            val fill by animateColorAsState(if (on) c.segmentedSelected else androidx.compose.ui.graphics.Color.Transparent, tween(200), label = "segment")
            Box(
                Modifier.weight(1f).height(40.dp)
                    .then(if (on) Modifier.shadow(1.5.dp, RoundedCornerShape(9.dp), clip = false) else Modifier)
                    .clip(RoundedCornerShape(9.dp)).background(fill)
                    .clickable { onSelect(value) }
                    .semantics { selected = on; role = Role.Tab },
                contentAlignment = Alignment.Center,
            ) {
                Text(label, color = if (on) c.textPrimary else c.textSecondary, fontSize = 14.sp, fontWeight = FontWeight.Medium, maxLines = 1)
            }
        }
    }
}

/** A speaker's label for menus and dialogs: the name given, or "Parlant 2". */
@Composable
fun speakerLabel(speaker: Int, name: String?): String = name ?: stringResource(R.string.rec_speaker, (speaker + 1).toString())

/**
 * The speaker's label as a menu (the desktop's): rename the speaker, give this line to someone
 * else, or say all their lines are someone else's.
 */
@Composable
fun SpeakerMenu(
    speaker: Int, names: Map<Int, String>, speakers: List<Int>, you: String,
    onRename: () -> Unit, onReassign: (Int) -> Unit, onMerge: (Int) -> Unit,
) {
    val c = LocalPalette.current
    var open by remember { mutableStateOf(false) }
    val name = names[speaker]
    val label = speakerLabel(speaker, name)
    val others = speakers.filter { it != speaker }
    Box {
        // The chip is small: the touch area reaches 48 dp high around it.
        Box(Modifier.height(48.dp).clickable { open = true }.semantics { contentDescription = label }, contentAlignment = Alignment.Center) {
            SpeakerChip(speaker, name, you = name == you)
        }
        DropdownMenu(open, { open = false }, containerColor = c.background) {
            DropdownMenuItem(
                text = { Text(stringResource(R.string.speakers_rename), color = c.textPrimary) },
                leadingIcon = { Icon(painterResource(R.drawable.ic_pencil), null, tint = c.textPrimary, modifier = Modifier.size(20.dp)) },
                onClick = { open = false; onRename() },
            )
            if (others.isNotEmpty()) {
                MenuSection(stringResource(R.string.speakers_thisLine))
                others.forEach { o ->
                    DropdownMenuItem(text = { SpeakerChip(o, names[o], you = names[o] == you) }, onClick = { open = false; onReassign(o) })
                }
                MenuSection(stringResource(R.string.speakers_allLines, label))
                others.forEach { o ->
                    DropdownMenuItem(text = { SpeakerChip(o, names[o], you = names[o] == you) }, onClick = { open = false; onMerge(o) })
                }
            }
        }
    }
}

@Composable
private fun MenuSection(title: String) {
    val c = LocalPalette.current
    HorizontalDivider(color = c.separator, modifier = Modifier.padding(vertical = 4.dp))
    Text(title, color = c.textSecondary, fontSize = 13.sp, modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp))
}

/** "Canvia el nom…" of a speaker: a dialog with the name in a field. */
@Composable
fun SpeakerNameDialog(current: String?, onDismiss: () -> Unit, onSave: (String) -> Unit) {
    val c = LocalPalette.current
    var name by remember { mutableStateOf(current ?: "") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.speakers_nameTitle)) },
        text = {
            OutlinedTextField(
                name, { name = it }, singleLine = true,
                placeholder = { Text(stringResource(R.string.speakers_namePlaceholder), color = c.textTertiary) },
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedTextColor = c.textPrimary, unfocusedTextColor = c.textPrimary, cursorColor = c.caret,
                    focusedBorderColor = c.textPrimary, unfocusedBorderColor = c.separator,
                ),
            )
        },
        confirmButton = { TextButton({ onSave(name); onDismiss() }) { Text(stringResource(R.string.meeting_save), color = c.textPrimary) } },
        dismissButton = { TextButton(onDismiss) { Text(stringResource(R.string.meeting_cancel), color = c.textSecondary) } },
        containerColor = c.background, titleContentColor = c.textPrimary,
    )
}
