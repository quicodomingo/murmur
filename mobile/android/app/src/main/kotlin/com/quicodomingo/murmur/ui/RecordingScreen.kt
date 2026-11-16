package com.quicodomingo.murmur.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.quicodomingo.murmur.R
import com.quicodomingo.murmur.Store

@Composable
fun languageName(code: String): String = stringResource(
    when (code) {
        "ca" -> R.string.language_ca
        "es" -> R.string.language_es
        "en" -> R.string.language_en
        else -> R.string.language_caEs
    },
)

/** The recording: its state and time on top, the live transcript, and the controls at the bottom. */
@Composable
fun RecordingScreen(store: Store, onBack: () -> Unit, onMark: () -> Unit, onPause: () -> Unit, onStop: () -> Unit, onDiscard: () -> Unit) {
    val c = LocalPalette.current
    val live = store.live ?: return
    var menu by remember { mutableStateOf(false) }
    var discarding by remember { mutableStateOf(false) }
    val haptic = LocalHapticFeedback.current
    val list = rememberLazyListState()
    val you = stringResource(R.string.rec_you)
    LaunchedEffect(live.lines.size, live.partial.isEmpty()) {
        val last = live.lines.size + (if (live.partial.isEmpty()) 0 else 1) - 1
        if (last >= 0) list.animateScrollToItem(last)
    }

    Column(Modifier.fillMaxSize().background(c.background).statusBarsPadding().navigationBarsPadding()) {
        // The top bar: back to the list (the recording carries on), the title and the … menu.
        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconCircle(R.drawable.ic_back, stringResource(R.string.rec_back), onBack)
            Text(live.title, color = c.textPrimary, fontSize = 22.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f).padding(horizontal = 8.dp))
            Box {
                IconCircle(R.drawable.ic_more, stringResource(R.string.recMenu_more)) { menu = true }
                DropdownMenu(menu, { menu = false }, containerColor = c.background) {
                    DropdownMenuItem(text = { Text(stringResource(R.string.recMenu_discard), color = c.speaker2Text) },
                        onClick = { menu = false; discarding = true })
                }
            }
        }

        // The state and the time.
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp).clip(RoundedCornerShape(24.dp)).background(c.fillSubtle).padding(18.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(8.dp).background(if (live.paused) c.textTertiary else c.recordingDot, CircleShape))
                Spacer(Modifier.width(8.dp))
                Text(stringResource(if (live.paused) R.string.rec_pause else R.string.rec_recording) + " · " + languageName(store.language),
                    color = c.recordingLabel, fontSize = 14.sp, fontWeight = FontWeight.Medium)
            }
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 4.dp)) {
                Text(clock(store.seconds), color = c.textPrimary, fontSize = 40.sp, fontWeight = FontWeight.Light, style = Tabular, modifier = Modifier.weight(1f))
                if (!live.paused) Levels(store.level, c.recordingLevel, height = 28)
            }
        }

        LazyColumn(
            Modifier.weight(1f).fillMaxWidth(), state = list,
            contentPadding = PaddingValues(horizontal = 20.dp, vertical = 16.dp), verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            if (live.lines.isEmpty() && live.partial.isEmpty()) {
                item { Text(stringResource(R.string.rec_listening), color = c.textSecondary, fontSize = 17.sp) }
            }
            items(live.lines, key = { it.id }) { line ->
                val speaker = line.speaker.toInt()
                val name = live.speakerNames[speaker]
                Column {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        SpeakerChip(speaker, name, you = name == you)
                        Text(minuteMark(line.start), color = c.timestamp, fontSize = 13.sp, style = Tabular)
                        if (live.isMarked(line)) MarkChip()
                    }
                    Text(line.text, color = c.textPrimary, fontSize = 17.sp, lineHeight = 24.sp, modifier = Modifier.padding(top = 5.dp))
                }
            }
            if (live.partial.isNotEmpty()) {
                item(key = "partial") { Text(live.partial, color = c.textTertiary, fontSize = 17.sp, lineHeight = 24.sp) }
            }
        }

        // Marca, Pausa / Continua and Atura.
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Box(
                Modifier.size(56.dp).clip(RoundedCornerShape(18.dp)).background(c.fillSubtle)
                    .clickable { haptic.performHapticFeedback(HapticFeedbackType.LongPress); onMark() },
                contentAlignment = Alignment.Center,
            ) { Icon(painterResource(R.drawable.ic_flag), stringResource(R.string.rec_mark), tint = c.textPrimary, modifier = Modifier.size(22.dp)) }
            Pill(if (live.paused) R.drawable.ic_play else R.drawable.ic_pause, stringResource(if (live.paused) R.string.rec_resume else R.string.rec_pause),
                c.fillSubtle, c.textPrimary, Modifier.weight(1f), onPause)
            Pill(R.drawable.ic_stop, stringResource(R.string.rec_stop), c.textPrimary, c.background, Modifier.weight(1f), onStop)
        }
    }

    if (discarding) {
        AlertDialog(
            onDismissRequest = { discarding = false },
            title = { Text(stringResource(R.string.recMenu_discardTitle)) },
            text = { Text(stringResource(R.string.recMenu_discardMessage)) },
            confirmButton = { TextButton({ discarding = false; onDiscard() }) { Text(stringResource(R.string.recMenu_discardConfirm), color = c.speaker2Text) } },
            dismissButton = { TextButton({ discarding = false }) { Text(stringResource(R.string.meeting_cancel), color = c.textPrimary) } },
            containerColor = c.background, titleContentColor = c.textPrimary, textContentColor = c.textSecondary,
        )
    }
}

@Composable
fun IconCircle(icon: Int, label: String, onClick: () -> Unit) {
    val c = LocalPalette.current
    Box(Modifier.size(48.dp).clip(CircleShape).clickable(onClick = onClick).semantics { contentDescription = label }, contentAlignment = Alignment.Center) {
        Icon(painterResource(icon), null, tint = c.textPrimary, modifier = Modifier.size(24.dp))
    }
}

@Composable
private fun Pill(icon: Int, label: String, background: androidx.compose.ui.graphics.Color, content: androidx.compose.ui.graphics.Color, modifier: Modifier, onClick: () -> Unit) {
    Row(
        modifier.height(56.dp).clip(RoundedCornerShape(20.dp)).background(background).clickable(onClick = onClick),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center,
    ) {
        Icon(painterResource(icon), null, tint = content, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(8.dp))
        Text(label, color = content, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
    }
}
