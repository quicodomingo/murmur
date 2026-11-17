package com.quicodomingo.murmur.ui

import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.quicodomingo.murmur.NoteBlock
import com.quicodomingo.murmur.NoteBlock.Kind
import com.quicodomingo.murmur.R
import com.quicodomingo.murmur.ensureTrailing
import com.quicodomingo.murmur.insertBeforeTrailing
import com.quicodomingo.murmur.noteCount
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

/**
 * The notes as they're edited: the blocks, the one being written and what to do with each change
 * (save it). `now` is the meeting second, to stamp new blocks; null for a finished meeting.
 */
class NotesState(initial: List<NoteBlock>, private val now: (() -> Double)?, private val changed: (List<NoteBlock>) -> Unit) {
    val blocks = mutableStateListOf<NoteBlock>().apply { addAll(initial); ensureTrailing() }
    /** The block with the keyboard, if any. */
    var editing by mutableStateOf<String?>(null)
        private set
    /** A block just made by Return, to give it the keyboard. */
    var focusNext by mutableStateOf<String?>(null)

    val count: Int get() = blocks.noteCount()

    fun focused(id: String?) {
        val old = editing
        editing = id
        // A line left empty goes away (not the last one, where typing goes on).
        if (old != null && old != id) {
            val i = blocks.indexOfFirst { it.id == old }
            if (i >= 0 && i < blocks.size - 1 && blocks[i].isEmpty) { blocks.removeAt(i); changed(blocks.toList()) }
        }
    }

    private fun stamp(i: Int) {
        val b = blocks[i]
        if (b.t == null && !b.isEmpty) now?.let { blocks[i] = b.copy(t = kotlin.math.floor(it())) }
    }

    /** Typing in a block; Return (a new line in the text) splits it. */
    fun edit(id: String, text: String) {
        val i = blocks.indexOfFirst { it.id == id }.takeIf { it >= 0 } ?: return
        val newline = text.indexOf('\n')
        if (newline < 0) {
            blocks[i] = blocks[i].copy(text = text)
            stamp(i)
        } else {
            val before = text.substring(0, newline)
            val after = text.substring(newline + 1).replace('\n', ' ')
            val kind = blocks[i].kind
            if (before.isBlank() && after.isEmpty() && (kind == Kind.BULLET || kind == Kind.TASK)) {
                // Return on an empty item leaves the list.
                blocks[i] = blocks[i].copy(kind = Kind.PARAGRAPH, text = "")
            } else {
                blocks[i] = blocks[i].copy(text = before)
                stamp(i)
                val next = NoteBlock(kind = if (kind == Kind.HEADING) Kind.PARAGRAPH else kind, text = after)
                blocks.add(i + 1, next)
                stamp(i + 1)
                focusNext = next.id
            }
        }
        blocks.ensureTrailing()
        changed(blocks.toList())
    }

    fun toggle(id: String) {
        val i = blocks.indexOfFirst { it.id == id }.takeIf { it >= 0 } ?: return
        blocks[i] = blocks[i].copy(checked = !blocks[i].checked)
        changed(blocks.toList())
    }

    /** The format bar: the block being written becomes this kind, or a plain paragraph again. */
    fun format(kind: Kind) {
        val i = blocks.indexOfFirst { it.id == editing }.takeIf { it >= 0 } ?: return
        blocks[i] = blocks[i].copy(kind = if (blocks[i].kind == kind) Kind.PARAGRAPH else kind)
        changed(blocks.toList())
    }

    fun kindOfEditing(): Kind? = blocks.firstOrNull { it.id == editing }?.kind

    /** A marked moment or a photo, from the recording. */
    fun insert(block: NoteBlock) {
        blocks.insertBeforeTrailing(block)
        changed(blocks.toList())
    }
}

/** The notes editor, as items of a list: one line per block, the minute in the margin. */
fun LazyListScope.notesItems(state: NotesState, dataDir: File) {
    items(state.blocks, key = { "note-" + it.id }) { block ->
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(
                block.t?.let(::minuteMark) ?: "", color = LocalPalette.current.timestamp, fontSize = 12.sp, style = Tabular,
                textAlign = TextAlign.End, modifier = Modifier.width(40.dp).padding(top = 5.dp),
            )
            Box(Modifier.weight(1f)) { NoteContent(state, block, dataDir) }
        }
    }
}

@Composable
private fun NoteContent(state: NotesState, block: NoteBlock, dataDir: File) {
    val c = LocalPalette.current
    when (block.kind) {
        Kind.MARK -> Box(Modifier.padding(vertical = 2.dp)) { FlagChip(block.text) }
        Kind.PHOTO -> block.photo?.let { PhotoThumb(File(dataDir, it), block.t ?: 0.0) }
        else -> Row(verticalAlignment = Alignment.Top) {
            if (block.kind == Kind.BULLET) {
                Text("•", color = c.textPrimary, fontSize = 17.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(end = 8.dp))
            } else if (block.kind == Kind.TASK) {
                val label = stringResource(R.string.notes_task)
                Box(
                    Modifier.padding(end = 6.dp).size(28.dp).clip(RoundedCornerShape(6.dp)).clickable { state.toggle(block.id) }
                        .semantics { contentDescription = label; stateDescription = if (block.checked) "✓" else "" },
                    contentAlignment = Alignment.Center,
                ) {
                    if (block.checked) {
                        Box(Modifier.size(19.dp).background(c.toggleOn, RoundedCornerShape(5.dp)), contentAlignment = Alignment.Center) {
                            Icon(painterResource(R.drawable.ic_check), null, tint = c.toggleKnob, modifier = Modifier.size(15.dp))
                        }
                    } else {
                        Box(Modifier.size(19.dp).border(1.5.dp, c.textTertiary, RoundedCornerShape(5.dp)))
                    }
                }
            }
            NoteField(state, block)
        }
    }
}

@Composable
private fun NoteField(state: NotesState, block: NoteBlock) {
    val c = LocalPalette.current
    val requester = remember { FocusRequester() }
    val heading = block.kind == Kind.HEADING
    val done = block.kind == Kind.TASK && block.checked
    val style = TextStyle(
        color = if (done) c.textSecondary else c.textPrimary,
        fontSize = if (heading) 20.sp else 17.sp, lineHeight = if (heading) 26.sp else 24.sp,
        fontWeight = if (heading) FontWeight.Bold else FontWeight.Normal,
        textDecoration = if (done) TextDecoration.LineThrough else null,
    )
    LaunchedEffect(state.focusNext) {
        if (state.focusNext == block.id) { requester.requestFocus(); state.focusNext = null }
    }
    val last = state.blocks.lastOrNull()?.id == block.id
    BasicTextField(
        block.text, { state.edit(block.id, it) },
        textStyle = style, cursorBrush = SolidColor(c.caret),
        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
        modifier = Modifier.fillMaxWidth().focusRequester(requester).onFocusChanged {
            if (it.isFocused) state.focused(block.id) else if (state.editing == block.id) state.focused(null)
        },
        decorationBox = { inner ->
            Box {
                if (block.text.isEmpty() && last) Text(stringResource(R.string.notes_placeholder), style = style.copy(color = c.textTertiary))
                inner()
            }
        },
    )
}

/** A photo in the notes, with its minute on it. */
@Composable
fun PhotoThumb(file: File, t: Double) {
    val c = LocalPalette.current
    val image by produceState<android.graphics.Bitmap?>(null, file) {
        value = withContext(Dispatchers.IO) {
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeFile(file.path, bounds)
            var sample = 1
            while (bounds.outWidth / (sample * 2) >= 660) sample *= 2
            BitmapFactory.decodeFile(file.path, BitmapFactory.Options().apply { inSampleSize = sample })
        }
    }
    val label = stringResource(R.string.notes_photoAt, minuteMark(t))
    Box(
        Modifier.padding(vertical = 4.dp).width(220.dp).height(150.dp).clip(RoundedCornerShape(14.dp)).background(c.fillSubtle)
            .semantics { contentDescription = label },
        contentAlignment = Alignment.BottomEnd,
    ) {
        image?.let { Image(it.asImageBitmap(), null, contentScale = ContentScale.Crop, modifier = Modifier.matchParentSize()) }
        Text(
            label, color = c.toastText, fontSize = 12.sp, fontWeight = FontWeight.SemiBold,
            modifier = Modifier.padding(8.dp).background(c.toastBackground.copy(alpha = 0.7f), RoundedCornerShape(6.dp)).padding(horizontal = 7.dp, vertical = 2.dp),
        )
    }
}

/**
 * Above the keyboard, while writing a note: heading, list, checkbox, a photo (while recording)
 * and Fet, which puts the keyboard away.
 */
@Composable
fun NotesFormatBar(state: NotesState, onPhoto: (() -> Unit)? = null, trailing: @Composable () -> Unit = {}) {
    val c = LocalPalette.current
    val focus = LocalFocusManager.current
    val current = state.kindOfEditing()
    Column {
        HorizontalDivider(color = c.separator)
        Row(
            Modifier.fillMaxWidth().background(c.background).height(52.dp).padding(horizontal = 6.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            FormatButton(R.drawable.ic_heading, stringResource(R.string.notes_heading), current == Kind.HEADING) { state.format(Kind.HEADING) }
            FormatButton(R.drawable.ic_list, stringResource(R.string.notes_list), current == Kind.BULLET) { state.format(Kind.BULLET) }
            FormatButton(R.drawable.ic_checklist, stringResource(R.string.notes_task), current == Kind.TASK) { state.format(Kind.TASK) }
            if (onPhoto != null) FormatButton(R.drawable.ic_camera, stringResource(R.string.notes_photo), false, onPhoto)
            Spacer(Modifier.weight(1f))
            trailing()
            Box(Modifier.height(44.dp).clip(RoundedCornerShape(10.dp)).clickable { focus.clearFocus() }.padding(horizontal = 12.dp), contentAlignment = Alignment.Center) {
                Text(stringResource(R.string.notes_done), color = c.textPrimary, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
            }
        }
    }
}

@Composable
private fun FormatButton(icon: Int, label: String, on: Boolean, onClick: () -> Unit) {
    val c = LocalPalette.current
    Box(
        Modifier.size(44.dp).clip(RoundedCornerShape(10.dp)).background(if (on) c.fillSubtle else androidx.compose.ui.graphics.Color.Transparent)
            .clickable(onClick = onClick).semantics { contentDescription = label; selected = on },
        contentAlignment = Alignment.Center,
    ) { Icon(painterResource(icon), null, tint = c.textPrimary, modifier = Modifier.size(20.dp)) }
}
