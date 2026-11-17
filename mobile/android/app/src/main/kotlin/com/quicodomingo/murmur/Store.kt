package com.quicodomingo.murmur

import android.content.Context
import android.os.Handler
import android.os.Looper
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import org.json.JSONArray
import org.json.JSONObject
import uniffi.murmur_mobile.Line
import uniffi.murmur_mobile.MeetingRow
import uniffi.murmur_mobile.Murmur
import java.io.File
import java.util.concurrent.Executors

/** The recording in progress, as the screens and the notification show it. */
class LiveMeeting(val id: String, title: String) {
    var title by mutableStateOf(title)
    val lines = mutableStateListOf<Line>()
    var partial by mutableStateOf("")
    var paused by mutableStateOf(false)
    /** The moments marked as important, in seconds. */
    val marks = mutableStateListOf<Double>()
    /** Names given while recording, by speaker number. */
    val speakerNames = mutableMapOf<Int, String>()

    fun isMarked(line: Line) = marks.any { it >= line.start - 1 && it <= line.end + 2 }
}

/**
 * The app's state: the meetings on this phone and the recording, over murmur-mobile (Rust).
 * Every call to the engine goes through one thread, in order. The microphone never waits for it
 * (RecordingService): when the engine is behind, the audio queues up instead of being lost.
 */
class Store(private val context: Context) {
    // Development: the models are copied by hand into the app's private folder (adb and run-as;
    // Android hides files that adb leaves in the external one), until they come in an asset pack.
    private val modelsDir = File(context.filesDir, "models")
    val dataDir: File = context.filesDir
    private val prefs = context.getSharedPreferences("murmur", Context.MODE_PRIVATE)
    private val engineThread = Executors.newSingleThreadExecutor { Thread(it, "murmur-engine").apply { priority = Thread.MAX_PRIORITY } }
    private val main = Handler(Looper.getMainLooper())

    @Volatile var engine: Murmur? = null
        private set
    val meetings = mutableStateListOf<MeetingRow>()
    var live by mutableStateOf<LiveMeeting?>(null)
        private set
    var ready by mutableStateOf(false)
        private set
    var error by mutableStateOf<String?>(null)
    /** Seconds recorded, counted on the microphone's side (pauses don't count). */
    var seconds by mutableStateOf(0.0)
        private set
    /** The last piece's level (rms), for the bars. */
    var level by mutableStateOf(0f)
        private set
    /** The meeting just stopped and saved, to open it. */
    var justSaved: String? = null
    /** Called on the main thread when the recording changes in a way the notification shows. */
    var onLiveChanged: (() -> Unit)? = null

    /** Wall clock of the start of the current run, for the notification's chronometer. */
    var runStartedAt = 0L
        private set

    val language: String get() = prefs.getString("language", "ca-es") ?: "ca-es"
    val partialEvery: Float get() = prefs.getFloat("partialEvery", 1.5f)
    val moreInRoom: Boolean get() = prefs.getBoolean("moreInRoom", true)

    init {
        engineThread.execute {
            runCatching { Murmur(modelsDir.path, dataDir.path).also { it.prepare() } }
                .onSuccess { e -> engine = e; main.post { ready = true; reload() } }
                .onFailure { e -> main.post { error = e.message } }
        }
    }

    /** Goes up on every reload, so an open meeting reads itself again (names, speakers). */
    var changes by mutableStateOf(0)
        private set

    fun reload() {
        val rows = runCatching { engine?.meetings() }.getOrNull() ?: return
        meetings.clear()
        meetings.addAll(rows)
        changes++
    }

    /** A change to a finished meeting, on the engine's thread (in order with the rest), then read again. */
    private fun edit(change: (Murmur) -> Unit) {
        val engine = engine ?: return
        engineThread.execute {
            runCatching { change(engine) }
            main.post { reload() }
        }
    }

    /** A speaker's name ("Parlant 2" is "Laia"); empty takes it away. */
    fun nameSpeaker(id: String, speaker: Int, name: String) = edit { it.setSpeakerName(id, speaker.toLong(), name) }

    /** One line goes to another speaker (the computer's final pass leaves it alone). */
    fun reassignLine(id: String, line: String, speaker: Int) = edit { it.setLineSpeaker(id, line, speaker.toLong()) }

    /** Every line of `from` is `into`'s: two speakers that were the same person. */
    fun mergeSpeakers(id: String, from: Int, into: Int) {
        if (from != into) edit { it.mergeSpeakers(id, from.toLong(), into.toLong()) }
    }

    /** A finished meeting's notes, as they're edited (no reload: the screen has them). */
    fun saveNotes(id: String, blocks: List<NoteBlock>) {
        val engine = engine ?: return
        val doc = (NotesDoc.encode(blocks) ?: JSONObject().put("type", "doc").put("content", JSONArray().put(JSONObject().put("type", "paragraph")))).toString()
        engineThread.execute { runCatching { engine.setNotes(id, doc) } }
    }

    /** Starts a meeting in the engine; RecordingService opens the microphone. */
    fun start(title: String, done: (Boolean) -> Unit) {
        val engine = engine ?: return done(false)
        if (live != null) return done(true)
        val language = language
        val every = partialEvery
        val room = moreInRoom
        engineThread.execute {
            val result = runCatching { engine.start(title, language, room, every) }
            main.post {
                result.onSuccess { id ->
                    live = LiveMeeting(id, title).also { m ->
                        // With the user's voice saved, speaker 0 is them (the engine knows them from the first word).
                        if (engine.voiceSaved() != null) m.speakerNames[0] = context.getString(R.string.rec_you)
                    }
                    seconds = 0.0
                    level = 0f
                    runStartedAt = System.currentTimeMillis()
                    done(true)
                }.onFailure { error = it.message; done(false) }
            }
        }
    }

    /** A piece of audio from the microphone's thread. Queued for the engine, never dropped. */
    fun push(samples: FloatArray) {
        val engine = engine ?: return
        var sum = 0f
        for (s in samples) sum += s * s
        val rms = if (samples.isEmpty()) 0f else kotlin.math.sqrt(sum / samples.size)
        main.post {
            if (live?.paused == false) {
                seconds += samples.size / 16_000.0
                level = rms
            }
        }
        engineThread.execute {
            val update = runCatching { engine.push(samples.asList()) }.getOrNull() ?: return@execute
            main.post {
                val current = live ?: return@post
                current.lines.addAll(update.finals)
                if (update.finals.isNotEmpty()) current.partial = ""
                update.partial?.let { current.partial = it }
                if (update.finals.isNotEmpty()) onLiveChanged?.invoke()
            }
        }
    }

    val isPaused: Boolean get() = live?.paused == true

    fun togglePause() {
        val current = live ?: return
        current.paused = !current.paused
        if (!current.paused) runStartedAt = System.currentTimeMillis() - (seconds * 1000).toLong()
        level = 0f
        onLiveChanged?.invoke()
    }

    fun mark() {
        val current = live ?: return
        current.marks.add(kotlin.math.floor(seconds))
        onLiveChanged?.invoke()
    }

    /** Stopped and saving: the engine first catches up with the queued audio, which takes a while on slow phones. */
    var stopping by mutableStateOf(false)
        private set

    /** Stops and saves; `done` gets the meeting's id. The engine first catches up with the queue. */
    fun stop(done: (String?) -> Unit = {}) {
        val engine = engine ?: return done(null)
        val current = live ?: return done(null)
        // A second stop while the first is still saving (two quick taps) does nothing.
        if (stopping) return done(null)
        stopping = true
        val extra = extra(current)
        engineThread.execute {
            val result = runCatching { engine.stop(extra) }
            main.post {
                stopping = false
                justSaved = result.getOrNull()
                live = null
                result.onFailure { error = it.message }
                reload()
                onLiveChanged?.invoke()
                done(result.getOrNull())
            }
        }
    }

    /** Throws the recording away: nothing saved, its audio deleted. */
    fun discard() {
        val engine = engine ?: return
        if (live == null) return
        engineThread.execute {
            runCatching { engine.discard() }
            main.post { live = null; reload(); onLiveChanged?.invoke() }
        }
    }

    fun delete(id: String) {
        runCatching { engine?.deleteMeeting(id) }
        reload()
    }

    fun rename(id: String, title: String) {
        val t = title.trim()
        if (t.isEmpty()) return
        runCatching { engine?.renameMeeting(id, t) }
        reload()
    }

    fun meeting(id: String): MeetingDetail? {
        val json = runCatching { engine?.meetingJson(id) }.getOrNull() ?: return null
        val row = meetings.firstOrNull { it.id == id }
        return MeetingDetail.parse(json, sent = row?.sent ?: false, revised = row?.revised ?: false, markLabel = context.getString(R.string.rec_markNote))
    }

    /**
     * Development (`adb shell am start … --es bench file.wav`): a 16 kHz mono float WAV from the
     * app's folder, through the engine as fast as it goes. The log gets the time against real time
     * and the text; nothing is saved.
     */
    fun bench(name: String, every: Float) {
        engineThread.execute {
            val engine = engine ?: return@execute
            val bytes = File(dataDir, name).readBytes()
            val data = (0 until bytes.size - 8).first { String(bytes, it, 4) == "data" } + 8
            val buf = java.nio.ByteBuffer.wrap(bytes, data, bytes.size - data).order(java.nio.ByteOrder.LITTLE_ENDIAN).asFloatBuffer()
            val samples = FloatArray(buf.remaining()).also { buf.get(it) }
            val text = StringBuilder()
            val t0 = System.nanoTime()
            engine.start("bench", "ca-es", false, every)
            for (i in samples.indices step 1600) {
                engine.push(samples.copyOfRange(i, minOf(i + 1600, samples.size)).asList()).finals.forEach { text.append(it.text).append(' ') }
            }
            val live = (System.nanoTime() - t0) / 1e9
            engine.discard()
            val audio = samples.size / 16_000.0
            android.util.Log.d("Murmur", "bench (every %.1f s): %.1f s of audio in %.1f s (%.0f%% of real time)".format(every, audio, live, 100 * live / audio))
            android.util.Log.d("Murmur", "bench text: $text")
        }
    }

    /** Development (`--es deleteTitled bench`): deletes the meetings with this title, such as old speed tests. */
    fun deleteTitled(title: String) {
        engineThread.execute {
            val engine = engine ?: return@execute
            runCatching { engine.meetings() }.getOrNull()?.filter { it.title == title }?.forEach { runCatching { engine.deleteMeeting(it.id) } }
            main.post { reload() }
        }
    }

    /** What the app adds to the meeting when it stops: its title, marks and speakers' names. */
    private fun extra(live: LiveMeeting): String = JSONObject().apply {
        put("title", live.title)
        put("marks", JSONArray(live.marks.map { JSONObject().put("t", it) }))
        put("speakerNames", JSONObject(live.speakerNames.mapKeys { it.key.toString() }))
    }.toString()

    companion object {
        @Volatile private var instance: Store? = null
        fun get(context: Context): Store = instance ?: synchronized(this) {
            instance ?: Store(context.applicationContext).also { instance = it }
        }
    }
}

/** A finished meeting, read from the computer's JSON format. */
data class MeetingDetail(
    val title: String,
    val createdAt: Long,
    val duration: Double,
    val utterances: List<Utterance>,
    val speakerNames: Map<Int, String>,
    val tags: List<String>,
    val marks: List<Double>,
    val sent: Boolean,
    val revised: Boolean,
    /** The notes, the marked moments and the photos, as the editor shows them. */
    val notes: List<NoteBlock>,
) {
    data class Utterance(val id: String, val start: Double, val end: Double, val speaker: Int, val text: String)

    fun isMarked(u: Utterance) = marks.any { it >= u.start - 1 && it <= u.end + 2 }
    val voices: Int get() = utterances.map { it.speaker }.toSet().size
    /** The speakers there are, by number. */
    val speakers: List<Int> get() = utterances.map { it.speaker }.distinct().sorted()

    companion object {
        fun parse(json: String, sent: Boolean, revised: Boolean, markLabel: String): MeetingDetail? = runCatching {
            val m = JSONObject(json)
            val names = mutableMapOf<Int, String>()
            m.optJSONObject("speakerNames")?.let { o ->
                for (k in o.keys()) { val n = o.optString(k); k.toIntOrNull()?.let { if (n.isNotEmpty()) names[it] = n } }
            }
            val us = m.optJSONArray("utterances") ?: JSONArray()
            val marks = m.optJSONArray("marks") ?: JSONArray()
            val tags = m.optJSONArray("tags") ?: JSONArray()
            MeetingDetail(
                title = m.optString("title"),
                createdAt = m.optDouble("createdAt", 0.0).toLong(),
                duration = m.optDouble("duration", 0.0),
                utterances = (0 until us.length()).map { i ->
                    val u = us.getJSONObject(i)
                    Utterance(u.optString("id", "$i"), u.optDouble("start"), u.optDouble("end"), u.optInt("speaker"), u.optString("text"))
                },
                speakerNames = names,
                tags = (0 until tags.length()).map { tags.getString(it) },
                marks = (0 until marks.length()).mapNotNull { marks.optJSONObject(it)?.optDouble("t") },
                sent = sent,
                revised = revised,
                notes = NotesDoc.decode(
                    m.optJSONObject("notesDoc"),
                    (0 until marks.length()).mapNotNull { marks.optJSONObject(it)?.optDouble("t") }.toSet(),
                    m.optJSONArray("screens"),
                    markLabel,
                ),
            )
        }.getOrNull()
    }
}
