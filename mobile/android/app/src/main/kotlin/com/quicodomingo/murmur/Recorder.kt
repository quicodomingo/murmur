package com.quicodomingo.murmur

import android.annotation.SuppressLint
import android.content.Context
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import uniffi.murmur_mobile.Line
import uniffi.murmur_mobile.Murmur
import java.io.File

/**
 * The engine and the microphone. Every call to the engine goes through one thread, as on the
 * iPhone; the microphone reads 16 kHz mono floats in pieces of 100 ms and pushes them.
 */
class Recorder(context: Context) {
    // Development: the models are copied by hand into the app's private folder (adb and run-as;
    // Android hides files that adb leaves in the external one), until they come in an asset pack.
    private val modelsDir = File(context.filesDir, "models")
    private val dataDir = context.filesDir
    @OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
    private val engineThread = Dispatchers.IO.limitedParallelism(1)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var engine: Murmur? = null
    private var job: Job? = null

    val lines = mutableStateListOf<Line>()
    var partial by mutableStateOf("")
        private set
    var seconds by mutableStateOf(0.0)
        private set
    var recording by mutableStateOf(false)
        private set
    var ready by mutableStateOf(false)
        private set
    var error by mutableStateOf<String?>(null)
        private set

    init {
        scope.launch {
            runCatching {
                withContext(engineThread) {
                    Murmur(modelsDir.path, dataDir.path).also { it.prepare() }
                }
            }.onSuccess { engine = it; ready = true }
             .onFailure { error = it.message }
        }
    }

    @SuppressLint("MissingPermission") // MainActivity asks for the microphone first.
    fun start(title: String, language: String) {
        val engine = engine ?: return
        lines.clear()
        partial = ""
        recording = true
        job = scope.launch {
            runCatching {
                withContext(engineThread) { engine.start(title, language, false, 1.5f) }
                val rate = 16_000
                val min = AudioRecord.getMinBufferSize(rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_FLOAT)
                val mic = AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, rate, AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_FLOAT, maxOf(min, rate * 4))
                val piece = FloatArray(rate / 10)
                mic.startRecording()
                val began = System.nanoTime()
                var busy = 0L
                var pushed = 0L
                try {
                    while (isActive && recording) {
                        val n = withContext(Dispatchers.IO) { mic.read(piece, 0, piece.size, AudioRecord.READ_BLOCKING) }
                        if (n <= 0) continue
                        val t0 = System.nanoTime()
                        val update = withContext(engineThread) { engine.push(piece.copyOf(n).toList()) }
                        busy += System.nanoTime() - t0
                        pushed += n
                        // How fast the engine goes against real time (development).
                        if (pushed % (rate * 5) < n) {
                            val wall = (System.nanoTime() - began) / 1e9
                            android.util.Log.d("Murmur", "audio %.1f s, wall %.1f s, engine busy %.1f s (%.0f%% of real time)"
                                .format(pushed / rate.toDouble(), wall, busy / 1e9, 100 * busy / 1e9 / (pushed / rate.toDouble())))
                        }
                        lines.addAll(update.finals)
                        update.partial?.let { partial = it }
                        seconds = update.seconds
                    }
                } finally {
                    mic.stop()
                    mic.release()
                }
            }.onFailure { error = it.message; recording = false }
        }
    }

    /**
     * Development (`adb shell am start … --es bench file.wav`): a 16 kHz mono float WAV from the
     * app's folder, through the engine as fast as it goes. The log gets the time against real time and the text.
     */
    fun bench(name: String, every: Float) = scope.launch {
        while (!ready && error == null) kotlinx.coroutines.delay(200)
        val engine = engine ?: return@launch
        val bytes = File(dataDir, name).readBytes()
        val data = (0 until bytes.size - 8).first { String(bytes, it, 4) == "data" } + 8
        val buf = java.nio.ByteBuffer.wrap(bytes, data, bytes.size - data).order(java.nio.ByteOrder.LITTLE_ENDIAN).asFloatBuffer()
        val samples = FloatArray(buf.remaining()).also { buf.get(it) }
        val text = StringBuilder()
        val t0 = System.nanoTime()
        withContext(engineThread) {
            engine.start("bench", "ca-es", false, every)
            for (i in samples.indices step 1600) {
                engine.push(samples.copyOfRange(i, minOf(i + 1600, samples.size)).toList()).finals.forEach { text.append(it.text).append(' ') }
            }
        }
        val live = (System.nanoTime() - t0) / 1e9
        withContext(engineThread) { engine.stop("{}") }
        val audio = samples.size / 16_000.0
        android.util.Log.d("Murmur", "bench (every %.1f s): %.1f s of audio in %.1f s (%.0f%% of real time)".format(every, audio, live, 100 * live / audio))
        android.util.Log.d("Murmur", "bench text: $text")
    }

    fun stop() {
        val engine = engine ?: return
        recording = false
        scope.launch {
            job?.join()
            runCatching { withContext(engineThread) { engine.stop("{}") } }.onFailure { error = it.message }
            partial = ""
        }
    }
}
