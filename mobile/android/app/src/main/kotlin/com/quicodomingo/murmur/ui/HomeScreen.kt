package com.quicodomingo.murmur.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.quicodomingo.murmur.R
import com.quicodomingo.murmur.Store
import uniffi.murmur_mobile.MeetingRow
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.time.temporal.WeekFields
import java.util.Locale

/** The list: the recording in progress on top, then the meetings by day, and the new-meeting button. */
@Composable
fun HomeScreen(store: Store, onOpen: (String) -> Unit, onOpenLive: () -> Unit, onNew: () -> Unit) {
    val c = LocalPalette.current
    var deleting by remember { mutableStateOf<MeetingRow?>(null) }
    val live = store.live
    val sections = remember(store.meetings.toList()) { group(store.meetings.filter { it.id != live?.id }) }
    val labels = mapOf(
        Day.Today to stringResource(R.string.home_today), Day.Yesterday to stringResource(R.string.home_yesterday),
        Day.ThisWeek to stringResource(R.string.home_thisWeek), Day.Earlier to stringResource(R.string.home_earlier),
    )

    Box(Modifier.fillMaxSize().background(c.background)) {
        LazyColumn(
            Modifier.fillMaxSize().statusBarsPadding(),
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 140.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            item { BrandBar() }
            store.error?.let { e -> item { Text(e, color = c.speaker2Text, fontSize = 14.sp, modifier = Modifier.padding(4.dp)) } }
            if (live != null) {
                item { SectionTitle(labels.getValue(Day.Today)) }
                item { LiveCard(store, onOpenLive) }
            }
            if (live == null && sections.isEmpty() && store.ready) item { Empty() }
            sections.forEach { (day, rows) ->
                if (!(live != null && day == Day.Today)) item(key = "s-$day") { SectionTitle(labels.getValue(day)) }
                items(rows, key = { it.id }) { row ->
                    MeetingCard(row, day, onClick = { onOpen(row.id) }, onLongClick = { deleting = row })
                }
            }
        }
        // The engine takes a few seconds to load on slow phones: the mark, breathing, rather than an empty list.
        AnimatedVisibility(!store.ready && store.error == null, Modifier.align(Alignment.Center), enter = fadeIn(), exit = fadeOut(tween(250))) {
            Loading()
        }
        Dock(store, onNew, onOpenLive, Modifier.align(Alignment.BottomCenter))
    }

    deleting?.let { row ->
        AlertDialog(
            onDismissRequest = { deleting = null },
            title = { Text(stringResource(R.string.meeting_delete)) },
            text = { Text(stringResource(R.string.meeting_deleteConfirm)) },
            confirmButton = { TextButton({ store.delete(row.id); deleting = null }) { Text(stringResource(R.string.home_delete), color = c.speaker2Text) } },
            dismissButton = { TextButton({ deleting = null }) { Text(stringResource(R.string.meeting_cancel), color = c.textPrimary) } },
            containerColor = c.background, titleContentColor = c.textPrimary, textContentColor = c.textSecondary,
        )
    }
}

private enum class Day { Today, Yesterday, ThisWeek, Earlier }

private fun dateOf(row: MeetingRow): LocalDate = Instant.ofEpochMilli(row.createdAt.toLong()).atZone(ZoneId.systemDefault()).toLocalDate()

private fun group(rows: List<MeetingRow>): List<Pair<Day, List<MeetingRow>>> {
    val today = LocalDate.now()
    val week = WeekFields.of(Locale.getDefault())
    fun day(d: LocalDate) = when {
        d == today -> Day.Today
        d == today.minusDays(1) -> Day.Yesterday
        d.get(week.weekOfWeekBasedYear()) == today.get(week.weekOfWeekBasedYear()) && d.year == today.year -> Day.ThisWeek
        else -> Day.Earlier
    }
    return rows.sortedByDescending { it.createdAt }.groupBy { day(dateOf(it)) }.toList().sortedBy { it.first.ordinal }
}

/** Murmur's mark (the "m" with its echo) and the wordmark. */
@Composable
private fun BrandBar() {
    val c = LocalPalette.current
    Row(Modifier.fillMaxWidth().padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        Logo(Modifier.size(34.dp))
        Spacer(Modifier.width(10.dp))
        Text("murmur", color = c.textPrimary, fontSize = 24.sp, fontWeight = FontWeight.Bold, letterSpacing = (-0.5).sp)
    }
}

private val logoPath = PathParser().parsePathString("M60 140 V100 a18 18 0 0 1 36 0 V140 M96 100 a18 18 0 0 1 36 0 V140").toPath()

/** `echo` places the echo: 1 where the mark has it (+15, −15), 0 hidden right behind the "m". */
@Composable
fun Logo(modifier: Modifier = Modifier, corner: Dp = 9.dp, echo: Float = 1f) {
    val c = LocalPalette.current
    Canvas(modifier.clip(RoundedCornerShape(corner)).background(c.logoBackground)) {
        val k = size.minDimension / 140f
        scale(k, Offset.Zero) {
            translate(-30f, -30f) {
                translate(15f * echo, -15f * echo) {
                    drawPath(logoPath, c.logoBar2.copy(alpha = echo), style = Stroke(17f, cap = StrokeCap.Round, join = StrokeJoin.Round))
                }
                drawPath(logoPath, c.logoBackground, style = Stroke(27f, cap = StrokeCap.Round, join = StrokeJoin.Round))
                drawPath(logoPath, c.logoBar1, style = Stroke(17f, cap = StrokeCap.Round, join = StrokeJoin.Round))
            }
        }
    }
}

/**
 * While the engine loads: the mark large, its echo coming out from behind the "m" and going back
 * (Eco: every word is said and then written), and a quiet line below. Still with animations off.
 */
@Composable
private fun Loading() {
    val c = LocalPalette.current
    val context = LocalContext.current
    val still = remember {
        android.provider.Settings.Global.getFloat(context.contentResolver, android.provider.Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
    }
    val echo = if (still) 1f else rememberInfiniteTransition(label = "loading").animateFloat(
        0.15f, 1f, infiniteRepeatable(tween(1100, easing = FastOutSlowInEasing), RepeatMode.Reverse), label = "echo",
    ).value
    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.semantics(mergeDescendants = true) {}) {
        // The ring (DESIGN.md: logoRing) keeps the black square from vanishing on a dark background.
        Logo(Modifier.size(96.dp).border(1.dp, c.logoRing, RoundedCornerShape(26.dp)), corner = 26.dp, echo = echo)
        Spacer(Modifier.height(20.dp))
        Text(stringResource(R.string.android_loading), color = c.textSecondary, fontSize = 15.sp)
    }
}

@Composable
private fun SectionTitle(text: String) {
    val c = LocalPalette.current
    Text(text, color = c.textSecondary, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(start = 4.dp, top = 14.dp, bottom = 2.dp))
}

@Composable
private fun Empty() {
    val c = LocalPalette.current
    Column(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 48.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(stringResource(R.string.home_emptyTitle), color = c.textPrimary, fontSize = 28.sp, fontWeight = FontWeight.Bold, letterSpacing = (-0.5).sp, lineHeight = 34.sp)
        Text(stringResource(R.string.home_emptyText), color = c.textSecondary, fontSize = 17.sp, lineHeight = 24.sp)
        Text(stringResource(R.string.home_consent), color = c.textTertiary, fontSize = 13.sp)
    }
}

@Composable
private fun CardIcon(content: @Composable () -> Unit) {
    val c = LocalPalette.current
    Box(Modifier.size(40.dp).background(c.fillSubtle, RoundedCornerShape(12.dp)), contentAlignment = Alignment.Center) { content() }
}

@Composable
private fun LiveCard(store: Store, onClick: () -> Unit) {
    val c = LocalPalette.current
    val live = store.live ?: return
    val last = live.partial.ifEmpty { live.lines.lastOrNull()?.text ?: "" }
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(24.dp)).background(c.fillSubtle).combinedClickable(onClick = onClick).padding(14.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        CardIcon { Levels(store.level, c.recordingLevel) }
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(live.title, color = c.textPrimary, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                Box(Modifier.size(8.dp).background(c.recordingDot, CircleShape))
                Spacer(Modifier.width(6.dp))
                Text(clock(store.seconds), color = c.textSecondary, fontSize = 15.sp, style = Tabular)
            }
            if (last.isNotEmpty()) {
                Text(last.takeLast(160), color = c.textPrimary, fontSize = 15.sp, lineHeight = 20.sp, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 4.dp))
            }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun MeetingCard(row: MeetingRow, day: Day, onClick: () -> Unit, onLongClick: () -> Unit) {
    val c = LocalPalette.current
    val at = Instant.ofEpochMilli(row.createdAt.toLong()).atZone(ZoneId.systemDefault())
    val time = at.format(DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT))
    val whenText = when (day) {
        Day.Today, Day.Yesterday -> time
        Day.ThisWeek -> at.format(DateTimeFormatter.ofPattern("EEEE")).replaceFirstChar { it.uppercase() } + " · " + time
        Day.Earlier -> at.format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM))
    }
    val revised = stringResource(R.string.home_revised)
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(24.dp)).background(c.fillSubtle)
            .combinedClickable(onClick = onClick, onLongClick = onLongClick).padding(14.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        CardIcon { Icon(painterResource(if (row.revised) R.drawable.ic_laptop else R.drawable.ic_phone), null, tint = c.textSecondary, modifier = Modifier.size(20.dp)) }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(row.title, color = c.textPrimary, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                Text("${maxOf(1, (row.duration / 60).toInt())} min", color = c.textSecondary, fontSize = 15.sp, style = Tabular)
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(if (row.revised) "$whenText · $revised" else whenText, color = c.textSecondary, fontSize = 14.sp)
                row.tags.take(2).forEach { tag ->
                    Text(tag, color = c.textSecondary, fontSize = 12.sp, fontWeight = FontWeight.Medium,
                        modifier = Modifier.background(c.sidebarSelection, RoundedCornerShape(6.dp)).padding(horizontal = 7.dp, vertical = 1.dp))
                }
            }
            row.lastLine?.takeIf { it.isNotEmpty() }?.let {
                Text(it, color = c.textTertiary, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

/** Material's floating toolbar: the new meeting, or, while recording, the pill back to it. */
@Composable
private fun Dock(store: Store, onNew: () -> Unit, onOpenLive: () -> Unit, modifier: Modifier) {
    val c = LocalPalette.current
    val live = store.live
    val label = if (live != null) stringResource(R.string.dock_recording, clock(store.seconds)) else stringResource(R.string.dock_new)
    Box(modifier.navigationBarsPadding().padding(bottom = 16.dp)) {
        Row(
            Modifier.shadow(12.dp, RoundedCornerShape(28.dp)).clip(RoundedCornerShape(28.dp))
                .background(if (live != null) c.recordingPill else c.newMeeting)
                .combinedClickable(enabled = store.ready || live != null, onClick = if (live != null) onOpenLive else onNew)
                .height(56.dp).padding(horizontal = 26.dp)
                .semantics { contentDescription = label },
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            if (live != null) {
                Levels(store.level, c.onRecordingPill)
                Text(clock(store.seconds), color = c.onRecordingPill, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, style = Tabular)
            } else {
                Icon(painterResource(R.drawable.ic_plus), null, tint = c.onNewMeeting, modifier = Modifier.size(24.dp))
                Text(stringResource(R.string.dock_new), color = c.onNewMeeting, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
            }
        }
    }
}
