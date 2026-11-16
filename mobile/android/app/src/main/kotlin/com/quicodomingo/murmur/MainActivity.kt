package com.quicodomingo.murmur

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import com.quicodomingo.murmur.ui.HomeScreen
import com.quicodomingo.murmur.ui.MeetingScreen
import com.quicodomingo.murmur.ui.MurmurTheme
import com.quicodomingo.murmur.ui.RecordingScreen
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        // Development: --es threads N, --es int8 0 (before the engine loads) and --es bench file.wav --ef every S.
        if (BuildConfig.DEBUG) {
            intent.getStringExtra("threads")?.let { android.system.Os.setenv("MURMUR_THREADS", it, true) }
            intent.getStringExtra("int8")?.let { android.system.Os.setenv("MURMUR_INT8", it, true) }
        }
        val store = Store.get(applicationContext)
        if (BuildConfig.DEBUG) intent.getStringExtra("bench")?.let { store.bench(it, intent.getFloatExtra("every", 1.5f)) }
        setContent { MurmurTheme { App(store) } }
    }
}

/** Where the app is: the list, the recording, or a meeting (by id). */
private const val HOME = "home"
private const val RECORDING = "recording"

@Composable
private fun App(store: Store) {
    val context = LocalContext.current
    var screen by rememberSaveable { mutableStateOf(if (store.live != null) RECORDING else HOME) }
    // The recording ended: to the meeting just saved, or back to the list (discarded, or a failure).
    LaunchedEffect(store.live == null) {
        if (store.live == null && screen == RECORDING) screen = store.justSaved ?: HOME
        store.justSaved = null
    }

    fun begin() {
        val title = context.getString(R.string.rec_defaultTitle, LocalTime.now().format(DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT)))
        store.start(title) { ok ->
            if (ok) {
                RecordingService.start(context)
                screen = RECORDING
            }
        }
    }

    // The microphone (needed) and, from Android 13, notifications (the recording's; without them it
    // still records). Asked together, the first time.
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { granted ->
        if (granted[Manifest.permission.RECORD_AUDIO] == true) begin() else store.error = context.getString(R.string.mic_denied)
    }
    fun newMeeting() {
        val needed = buildList {
            add(Manifest.permission.RECORD_AUDIO)
            if (Build.VERSION.SDK_INT >= 33) add(Manifest.permission.POST_NOTIFICATIONS)
        }.filter { ContextCompat.checkSelfPermission(context, it) != PackageManager.PERMISSION_GRANTED }
        store.error = null
        if (needed.isEmpty()) begin() else ask.launch(needed.toTypedArray())
    }

    BackHandler(enabled = screen != HOME) { screen = HOME }
    AnimatedContent(screen, transitionSpec = { fadeIn(tween(200)) togetherWith fadeOut(tween(150)) }, label = "screen") { current ->
        when (current) {
            HOME -> HomeScreen(store, onOpen = { screen = it }, onOpenLive = { screen = RECORDING }, onNew = ::newMeeting)
            RECORDING -> RecordingScreen(
                store,
                onBack = { screen = HOME },
                onMark = { RecordingService.send(context, RecordingService.MARK) },
                onPause = { RecordingService.send(context, RecordingService.PAUSE) },
                onStop = { RecordingService.stop(context) },
                onDiscard = { RecordingService.send(context, RecordingService.DISCARD) },
            )
            else -> MeetingScreen(store, current, onBack = { screen = HOME })
        }
    }
}
