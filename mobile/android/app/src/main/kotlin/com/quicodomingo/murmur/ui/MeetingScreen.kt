package com.quicodomingo.murmur.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.quicodomingo.murmur.R
import com.quicodomingo.murmur.Store
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

private enum class MeetingTab { TRANSCRIPT, NOTES }

/**
 * A finished meeting: when, how long and how many voices, its title and tags, and two tabs: the
 * transcript (the speakers' labels are menus: rename, this line is someone else's, merge two) and
 * the notes, editable and saved as they change.
 */
@Composable
fun MeetingScreen(store: Store, id: String, onBack: () -> Unit) {
    val c = LocalPalette.current
    val meeting = remember(id, store.changes) { store.meeting(id) } ?: return
    val notes = remember(id) { NotesState(meeting.notes, now = null) { store.saveNotes(id, it) } }
    var tab by rememberSaveable { mutableStateOf(MeetingTab.TRANSCRIPT) }
    var menu by remember { mutableStateOf(false) }
    var renaming by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf(false) }
    var naming by remember { mutableStateOf<Int?>(null) }
    val you = stringResource(R.string.rec_you)
    val at = Instant.ofEpochMilli(meeting.createdAt).atZone(ZoneId.systemDefault())
    val voices = if (meeting.voices == 1) stringResource(R.string.meetingVoices_one) else stringResource(R.string.meetingVoices_many, meeting.voices.toString())
    val meta = listOfNotNull(
        at.format(DateTimeFormatter.ofLocalizedDate(FormatStyle.LONG)),
        at.format(DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT)),
        "${maxOf(1, (meeting.duration / 60).toInt())} min",
        voices.takeIf { meeting.voices > 0 },
    ).joinToString(" · ")
    val notesLabel = stringResource(R.string.rec_notes).let { if (notes.count == 0) it else "$it · ${notes.count}" }

    Column(Modifier.fillMaxSize().background(c.background).statusBarsPadding().navigationBarsPadding().imePadding()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconCircle(R.drawable.ic_back, stringResource(R.string.rec_back), onBack)
            Box(Modifier.weight(1f))
            Box {
                IconCircle(R.drawable.ic_more, stringResource(R.string.recMenu_more)) { menu = true }
                DropdownMenu(menu, { menu = false }, containerColor = c.background) {
                    DropdownMenuItem(text = { Text(stringResource(R.string.meeting_rename), color = c.textPrimary) }, onClick = { menu = false; renaming = true })
                    DropdownMenuItem(text = { Text(stringResource(R.string.meeting_delete), color = c.speaker2Text) }, onClick = { menu = false; deleting = true })
                }
            }
        }
        LazyColumn(
            Modifier.weight(1f).fillMaxWidth(),
            contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 4.dp, bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(if (tab == MeetingTab.NOTES) 8.dp else 16.dp),
        ) {
            item(key = "header") {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(painterResource(if (meeting.revised) R.drawable.ic_laptop else R.drawable.ic_phone), null, tint = c.textSecondary, modifier = Modifier.size(16.dp))
                        Text(meta, color = c.textSecondary, fontSize = 14.sp, style = Tabular, modifier = Modifier.padding(start = 6.dp))
                    }
                    // Tapping the title renames it.
                    Text(
                        meeting.title, color = c.textPrimary, fontSize = 28.sp, fontWeight = FontWeight.Bold, lineHeight = 34.sp, letterSpacing = (-0.5).sp,
                        modifier = Modifier.clickable(onClickLabel = stringResource(R.string.meeting_rename)) { renaming = true },
                    )
                    if (meeting.tags.isNotEmpty()) {
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            meeting.tags.forEach { tag ->
                                Text(tag, color = c.textSecondary, fontSize = 13.sp, fontWeight = FontWeight.Medium,
                                    modifier = Modifier.background(c.sidebarSelection, RoundedCornerShape(8.dp)).padding(horizontal = 9.dp, vertical = 3.dp))
                            }
                        }
                    }
                    // Where it stands: only the phone's quick transcript (no computer yet on Android), sent, or revised.
                    val state = when {
                        meeting.revised -> R.string.meeting_revised
                        meeting.sent -> R.string.meeting_sent
                        else -> R.string.meeting_pendingUnpaired
                    }
                    Text(stringResource(state), color = c.textSecondary, fontSize = 14.sp, lineHeight = 20.sp,
                        modifier = Modifier.padding(top = 6.dp).fillMaxWidth().background(c.fillSubtle, RoundedCornerShape(14.dp)).padding(12.dp))
                    Segmented(
                        listOf(MeetingTab.TRANSCRIPT to stringResource(R.string.rec_transcript), MeetingTab.NOTES to notesLabel),
                        tab, Modifier.padding(top = 8.dp, bottom = 4.dp),
                    ) { tab = it }
                }
            }
            if (tab == MeetingTab.TRANSCRIPT) {
                if (meeting.utterances.isEmpty()) {
                    item { Text(stringResource(R.string.meeting_empty), color = c.textSecondary, fontSize = 17.sp) }
                }
                items(meeting.utterances, key = { it.id }) { u ->
                    Column {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            SpeakerMenu(
                                u.speaker, meeting.speakerNames, meeting.speakers, you,
                                onRename = { naming = u.speaker },
                                onReassign = { store.reassignLine(id, u.id, it) },
                                onMerge = { store.mergeSpeakers(id, u.speaker, it) },
                            )
                            Text(minuteMark(u.start), color = c.timestamp, fontSize = 13.sp, style = Tabular)
                            if (meeting.isMarked(u)) MarkChip()
                        }
                        Text(u.text, color = c.textPrimary, fontSize = 17.sp, lineHeight = 24.sp)
                    }
                }
            } else {
                notesItems(notes, store.dataDir)
            }
        }
        if (notes.editing != null && tab == MeetingTab.NOTES) NotesFormatBar(notes)
    }

    naming?.let { speaker ->
        SpeakerNameDialog(meeting.speakerNames[speaker], onDismiss = { naming = null }) { store.nameSpeaker(id, speaker, it) }
    }
    if (renaming) {
        var title by remember { mutableStateOf(meeting.title) }
        AlertDialog(
            onDismissRequest = { renaming = false },
            title = { Text(stringResource(R.string.meeting_renameTitle)) },
            text = {
                OutlinedTextField(title, { title = it }, singleLine = true, colors = OutlinedTextFieldDefaults.colors(
                    focusedTextColor = c.textPrimary, unfocusedTextColor = c.textPrimary, cursorColor = c.caret,
                    focusedBorderColor = c.textPrimary, unfocusedBorderColor = c.separator))
            },
            confirmButton = { TextButton({ store.rename(id, title); renaming = false }) { Text(stringResource(R.string.meeting_save), color = c.textPrimary) } },
            dismissButton = { TextButton({ renaming = false }) { Text(stringResource(R.string.meeting_cancel), color = c.textSecondary) } },
            containerColor = c.background, titleContentColor = c.textPrimary,
        )
    }
    if (deleting) {
        AlertDialog(
            onDismissRequest = { deleting = false },
            title = { Text(stringResource(R.string.meeting_delete)) },
            text = { Text(stringResource(R.string.meeting_deleteConfirm)) },
            confirmButton = { TextButton({ deleting = false; store.delete(id); onBack() }) { Text(stringResource(R.string.home_delete), color = c.speaker2Text) } },
            dismissButton = { TextButton({ deleting = false }) { Text(stringResource(R.string.meeting_cancel), color = c.textPrimary) } },
            containerColor = c.background, titleContentColor = c.textPrimary, textContentColor = c.textSecondary,
        )
    }
}
