package com.quicodomingo.murmur.ui

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.layout.imePadding
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
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.text.TextAutoSize
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
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.FileProvider
import com.quicodomingo.murmur.R
import com.quicodomingo.murmur.Store
import java.io.File

@Composable
fun languageName(code: String): String = stringResource(
    when (code) {
        "ca" -> R.string.language_ca
        "es" -> R.string.language_es
        "en" -> R.string.language_en
        else -> R.string.language_caEs
    },
)

private enum class LiveTab { TRANSCRIPT, NOTES }

/**
 * The recording: its state and time on top, the transcript or the notes, and the controls at the
 * bottom (a photo, a mark, Pausa and Atura). Writing a note, the format bar takes the controls' place.
 */
@Composable
fun RecordingScreen(store: Store, onBack: () -> Unit, onMark: () -> Unit, onPause: () -> Unit, onStop: () -> Unit, onDiscard: () -> Unit) {
    val c = LocalPalette.current
    val live = store.live ?: return
    val context = LocalContext.current
    var tab by rememberSaveable { mutableStateOf(LiveTab.TRANSCRIPT) }
    var menu by remember { mutableStateOf(false) }
    var discarding by remember { mutableStateOf(false) }
    var renaming by remember { mutableStateOf(false) }
    var naming by remember { mutableStateOf<Int?>(null) }
    var stopArmed by remember { mutableStateOf(false) }
    LaunchedEffect(stopArmed) {
        if (stopArmed) { kotlinx.coroutines.delay(4_000); stopArmed = false }
    }
    val haptic = LocalHapticFeedback.current
    val list = rememberLazyListState()
    val you = stringResource(R.string.rec_you)
    LaunchedEffect(live.lines.size, live.partial.isEmpty(), tab) {
        if (tab != LiveTab.TRANSCRIPT) return@LaunchedEffect
        val last = live.lines.size + (if (live.partial.isEmpty()) 0 else 1) - 1
        if (last >= 0) list.animateScrollToItem(last)
    }

    // The camera (the phone's own app, through a file only it can write): the photo goes into the
    // notes at the second it was taken. The file's name survives the activity being recreated.
    var shot by rememberSaveable { mutableStateOf<String?>(null) }
    val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        val file = shot?.let(::File)
        shot = null
        if (file != null) { if (ok && file.length() > 0) store.addPhoto(file) else file.delete() }
    }
    fun takePhoto() {
        val file = File(context.cacheDir, "camera/${System.currentTimeMillis()}.jpg").apply { parentFile?.mkdirs() }
        val uri: Uri = FileProvider.getUriForFile(context, context.packageName + ".files", file)
        shot = file.path
        runCatching { camera.launch(uri) }.onFailure { shot = null }
    }

    val notes = live.notes
    val writing = notes.editing != null && tab == LiveTab.NOTES
    val notesLabel = stringResource(R.string.rec_notes).let { if (notes.count == 0) it else "$it · ${notes.count}" }

    Column(Modifier.fillMaxSize().background(c.background).statusBarsPadding().navigationBarsPadding().imePadding()) {
        // The top bar: back to the list (the recording carries on), the title and the … menu.
        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconCircle(R.drawable.ic_back, stringResource(R.string.rec_back), onBack)
            Text(live.title, color = c.textPrimary, fontSize = 22.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f).padding(horizontal = 8.dp))
            Box {
                IconCircle(R.drawable.ic_more, stringResource(R.string.recMenu_more)) { menu = true }
                DropdownMenu(menu, { menu = false }, containerColor = c.background) {
                    DropdownMenuItem(text = { Text(stringResource(R.string.meeting_rename), color = c.textPrimary) },
                        onClick = { menu = false; renaming = true })
                    DropdownMenuItem(text = { Text(stringResource(R.string.recMenu_discard), color = c.speaker2Text) },
                        onClick = { menu = false; discarding = true })
                }
            }
        }

        // The state and the time (out of the way while writing, to leave room above the keyboard).
        if (!writing) {
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
        }

        Segmented(
            listOf(LiveTab.TRANSCRIPT to stringResource(R.string.rec_transcript), LiveTab.NOTES to notesLabel),
            tab, Modifier.padding(start = 16.dp, end = 16.dp, top = 14.dp),
        ) { tab = it }

        if (tab == LiveTab.TRANSCRIPT) {
            LazyColumn(
                Modifier.weight(1f).fillMaxWidth(), state = list,
                contentPadding = PaddingValues(horizontal = 20.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                if (live.lines.isEmpty() && live.partial.isEmpty()) {
                    item { Text(stringResource(R.string.rec_listening), color = c.textSecondary, fontSize = 17.sp) }
                }
                items(live.lines, key = { it.id }) { line ->
                    val speaker = live.speaker(line)
                    Column {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            SpeakerMenu(
                                speaker, live.speakerNames, live.speakers, you,
                                onRename = { naming = speaker },
                                onReassign = { store.reassignLiveLine(line.id, it) },
                                onMerge = { store.mergeLiveSpeakers(speaker, it) },
                            )
                            Text(minuteMark(line.start), color = c.timestamp, fontSize = 13.sp, style = Tabular)
                            if (live.isMarked(line)) MarkChip()
                        }
                        Text(line.text, color = c.textPrimary, fontSize = 17.sp, lineHeight = 24.sp)
                    }
                }
                if (live.partial.isNotEmpty()) {
                    item(key = "partial") { Text(live.partial, color = c.textTertiary, fontSize = 17.sp, lineHeight = 24.sp) }
                }
            }
        } else {
            LazyColumn(
                Modifier.weight(1f).fillMaxWidth(),
                contentPadding = PaddingValues(start = 8.dp, end = 20.dp, top = 14.dp, bottom = 20.dp), verticalArrangement = Arrangement.spacedBy(8.dp),
            ) { notesItems(notes, store.dataDir) }
        }

        if (writing) {
            NotesFormatBar(notes, onPhoto = ::takePhoto) {
                // The time, as on the iPhone: still recording while writing.
                Row(
                    Modifier.height(34.dp).background(c.recordingPill, CircleShape).padding(horizontal = 12.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp),
                ) {
                    Box(Modifier.size(8.dp).background(if (live.paused) c.textTertiary else c.recordingDot, CircleShape))
                    Text(clock(store.seconds), color = c.onRecordingPill, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, style = Tabular)
                }
            }
        } else {
            // A photo, Marca, Pausa / Continua and Atura.
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Square(R.drawable.ic_camera, stringResource(R.string.notes_photo)) { takePhoto() }
                Square(R.drawable.ic_flag, stringResource(R.string.rec_mark)) { haptic.performHapticFeedback(HapticFeedbackType.LongPress); onMark() }
                Pill(if (live.paused) R.drawable.ic_play else R.drawable.ic_pause, stringResource(if (live.paused) R.string.rec_resume else R.string.rec_pause),
                    c.fillSubtle, c.textPrimary, Modifier.weight(1f), enabled = !store.stopping, onClick = onPause)
                // Atura asks for a second tap within 4 s, as on the iPhone and in the notification: armed, it's the
                // dark red with white of the iPhone (acid light's recordingLabel, 5.6:1) in both modes. Then
                // «Desant…» until the engine has caught up with the queued audio and saved.
                val armed = stopArmed || store.stopping
                Pill(
                    R.drawable.ic_stop,
                    stringResource(if (store.stopping) R.string.rec_saving else if (stopArmed) R.string.rec_stopConfirm else R.string.rec_stop),
                    if (armed) MurmurPalette.acidLight.recordingLabel else c.textPrimary,
                    if (armed) MurmurPalette.acidLight.background else c.background,
                    Modifier.weight(1f),
                    enabled = !store.stopping,
                ) {
                    if (stopArmed) { stopArmed = false; onStop() } else { haptic.performHapticFeedback(HapticFeedbackType.LongPress); stopArmed = true }
                }
            }
        }
    }

    naming?.let { speaker ->
        SpeakerNameDialog(live.speakerNames[speaker], onDismiss = { naming = null }) { store.nameLiveSpeaker(speaker, it) }
    }
    if (renaming) RenameDialog(live.title, onDismiss = { renaming = false }) { store.renameLive(it) }
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

/** A square button beside Pausa and Atura (a photo, a marked moment). */
@Composable
private fun Square(icon: Int, label: String, onClick: () -> Unit) {
    val c = LocalPalette.current
    Box(
        Modifier.size(56.dp).clip(RoundedCornerShape(18.dp)).background(c.fillSubtle).clickable(onClick = onClick).semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) { Icon(painterResource(icon), null, tint = c.textPrimary, modifier = Modifier.size(22.dp)) }
}

@Composable
private fun Pill(icon: Int, label: String, background: Color, content: Color, modifier: Modifier, enabled: Boolean = true, onClick: () -> Unit) {
    Row(
        modifier.height(56.dp).clip(RoundedCornerShape(20.dp)).background(background).clickable(enabled = enabled, onClick = onClick).padding(horizontal = 10.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center,
    ) {
        Icon(painterResource(icon), null, tint = content, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(6.dp))
        // Four buttons share the row: a longer label («Toca per aturar») shrinks a little rather than cut.
        BasicText(
            label, maxLines = 1,
            style = TextStyle(color = content, fontSize = 17.sp, fontWeight = FontWeight.SemiBold),
            autoSize = TextAutoSize.StepBased(minFontSize = 12.sp, maxFontSize = 17.sp),
        )
    }
}
