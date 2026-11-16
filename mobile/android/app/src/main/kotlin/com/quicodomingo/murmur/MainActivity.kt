package com.quicodomingo.murmur

import android.Manifest
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.quicodomingo.murmur.ui.MurmurPalette
import uniffi.murmur_mobile.Line
import java.time.LocalTime
import java.time.format.DateTimeFormatter

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        // Development: --es threads N, --es int8 0 (before the engine loads) and --ef every S.
        if (BuildConfig.DEBUG) {
            intent.getStringExtra("threads")?.let { android.system.Os.setenv("MURMUR_THREADS", it, true) }
            intent.getStringExtra("int8")?.let { android.system.Os.setenv("MURMUR_INT8", it, true) }
        }
        val recorder = Recorder(applicationContext)
        if (BuildConfig.DEBUG) intent.getStringExtra("bench")?.let { recorder.bench(it, intent.getFloatExtra("every", 1.5f)) }
        setContent { RecordScreen(recorder) }
    }
}

/** The first screen: start, the live transcript with each speaker's tag, and stop. */
@Composable
fun RecordScreen(recorder: Recorder) {
    val c = MurmurPalette.acidLight
    val title = stringResource(R.string.rec_defaultTitle, LocalTime.now().format(DateTimeFormatter.ofPattern("H:mm")))
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) recorder.start(title, "ca-es")
    }
    val list = rememberLazyListState()
    LaunchedEffect(recorder.lines.size, recorder.partial) {
        val last = recorder.lines.size + (if (recorder.partial.isEmpty()) 0 else 1) - 1
        if (last >= 0) list.animateScrollToItem(last)
    }
    Column(Modifier.fillMaxSize().background(c.background).safeDrawingPadding().padding(horizontal = 20.dp)) {
        Text(
            if (recorder.recording) stringResource(R.string.rec_recording) else stringResource(R.string.home_emptyTitle),
            color = c.textPrimary, fontSize = 28.sp, fontWeight = FontWeight.Bold,
            modifier = Modifier.padding(top = 16.dp, bottom = 12.dp),
        )
        recorder.error?.let { Text(it, color = c.speaker2Text, fontSize = 14.sp) }
        LazyColumn(Modifier.weight(1f).fillMaxWidth(), state = list, verticalArrangement = Arrangement.spacedBy(14.dp),
            contentPadding = PaddingValues(vertical = 8.dp)) {
            if (recorder.recording && recorder.lines.isEmpty() && recorder.partial.isEmpty()) {
                item { Text(stringResource(R.string.rec_listening), color = c.textSecondary, fontSize = 17.sp) }
            }
            items(recorder.lines, key = { it.id }) { LineView(it) }
            if (recorder.partial.isNotEmpty()) {
                item { Text(recorder.partial, color = c.textTertiary, fontSize = 17.sp, lineHeight = 24.sp) }
            }
        }
        Box(Modifier.fillMaxWidth().padding(vertical = 16.dp), contentAlignment = Alignment.Center) {
            Button(
                onClick = { if (recorder.recording) recorder.stop() else ask.launch(Manifest.permission.RECORD_AUDIO) },
                enabled = recorder.ready,
                shape = RoundedCornerShape(28.dp),
                colors = ButtonDefaults.buttonColors(containerColor = c.textPrimary, contentColor = c.background),
                modifier = Modifier.height(56.dp),
            ) {
                Text(
                    if (recorder.recording) stringResource(R.string.rec_stop) else stringResource(R.string.onboarding_start),
                    fontSize = 17.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(horizontal = 24.dp),
                )
            }
        }
    }
}

@Composable
private fun LineView(line: Line) {
    val c = MurmurPalette.acidLight
    val (tint, text) = when (line.speaker.mod(3L)) {
        0L -> c.speaker1Tint to c.speaker1Text
        1L -> c.speaker2Tint to c.speaker2Text
        else -> c.speaker3Tint to c.speaker3Text
    }
    val minutes = remember(line.start) { "%d:%02d".format(line.start.toInt() / 60, line.start.toInt() % 60) }
    Column {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                stringResource(R.string.rec_speaker, (line.speaker + 1).toString()),
                color = text, fontSize = 13.sp, fontWeight = FontWeight.SemiBold,
                modifier = Modifier.background(tint, RoundedCornerShape(5.dp)).padding(horizontal = 8.dp, vertical = 1.dp),
            )
            Text(minutes, color = c.textTertiary, fontSize = 13.sp, modifier = Modifier.padding(start = 8.dp))
        }
        Text(line.text, color = c.textPrimary, fontSize = 17.sp, lineHeight = 24.sp, modifier = Modifier.padding(top = 4.dp))
    }
}
