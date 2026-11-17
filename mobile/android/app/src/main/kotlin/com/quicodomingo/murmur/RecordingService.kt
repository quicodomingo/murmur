package com.quicodomingo.murmur

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.drawable.Icon
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager

/**
 * The recording, as a foreground service: it keeps going with the screen off or in another app,
 * with a notification that can't be swiped away while it records (Android has no Live Activity).
 * The notification has the time, the last thing said, and Marca, Pausa and Atura; Atura asks
 * twice, as on the iPhone's lock screen.
 */
class RecordingService : Service() {
    private lateinit var store: Store
    private var mic: Thread? = null
    @Volatile private var running = false
    private var wakeLock: PowerManager.WakeLock? = null
    private val main = Handler(Looper.getMainLooper())
    private var stopArmed = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        store = Store.get(this)
        channel(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            MARK -> store.mark()
            PAUSE -> store.togglePause()
            STOP -> armOrStop()
            STOP_NOW -> end()
            DISCARD -> { running = false; mic?.join(500); store.discard(); finish() }
            else -> begin()
        }
        return START_NOT_STICKY
    }

    private fun begin() {
        if (running) return
        // A foreground service of type microphone: Android keeps the microphone open for it.
        val type = ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
        startForeground(ID, notification(), type)
        store.onLiveChanged = { refresh() }
        wakeLock = (getSystemService(POWER_SERVICE) as PowerManager)
            .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Murmur:recording").apply { acquire(6 * 60 * 60 * 1000L) }
        running = true
        mic = Thread(::listen, "murmur-mic").apply { priority = Thread.MAX_PRIORITY; start() }
    }

    /** The microphone's thread: 16 kHz mono floats in 100 ms pieces, straight to the store's queue. */
    @SuppressLint("MissingPermission") // MainActivity asks for the microphone before starting the service.
    private fun listen() {
        val rate = 16_000
        val min = AudioRecord.getMinBufferSize(rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_FLOAT)
        val record = runCatching {
            AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, rate, AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_FLOAT, maxOf(min, rate * 4))
        }.getOrNull()
        if (record == null || record.state != AudioRecord.STATE_INITIALIZED) {
            main.post { store.error = getString(R.string.mic_denied); store.discard(); finish() }
            return
        }
        record.startRecording()
        val piece = FloatArray(rate / 10)
        try {
            while (running) {
                val n = record.read(piece, 0, piece.size, AudioRecord.READ_BLOCKING)
                if (n <= 0 || store.isPaused) continue
                store.push(piece.copyOf(n))
            }
        } finally {
            record.stop()
            record.release()
        }
    }

    private fun armOrStop() {
        if (stopArmed) {
            stopArmed = false
            end()
            return
        }
        stopArmed = true
        refresh()
        main.postDelayed({ if (stopArmed) { stopArmed = false; refresh() } }, 4_000)
    }

    /** Stops the microphone and saves the meeting (the app's own Atura comes here too). */
    private fun end() {
        running = false
        mic?.join(500)
        store.stop()
        finish()
    }

    private fun finish() {
        running = false
        store.onLiveChanged = null
        wakeLock?.takeIf { it.isHeld }?.release()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        running = false
        wakeLock?.takeIf { it.isHeld }?.release()
        super.onDestroy()
    }

    private fun refresh() {
        if (!running) return
        if (store.live == null) { finish(); return }
        getSystemService(NotificationManager::class.java).notify(ID, notification())
    }

    private fun notification(): Notification {
        val live = store.live
        val paused = live?.paused == true
        val last = live?.lines?.lastOrNull()
        val who = last?.let { live.speaker(it) }?.let { s -> live.speakerNames[s] ?: getString(R.string.rec_speaker, (s + 1).toString()) }
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE)
        val builder = Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(getString(if (paused) R.string.rec_pause else R.string.rec_recording) + (live?.title?.let { " · $it" } ?: ""))
            .setContentText(last?.let { "$who: ${it.text.takeLast(140)}" } ?: getString(R.string.rec_listening))
            .setStyle(Notification.BigTextStyle().bigText(last?.let { "$who: ${it.text.takeLast(280)}" } ?: getString(R.string.rec_listening)))
            .setContentIntent(open)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(Notification.CATEGORY_SERVICE)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .addAction(action(MARK, R.drawable.ic_flag, getString(R.string.rec_mark)))
            .addAction(action(PAUSE, if (paused) R.drawable.ic_play else R.drawable.ic_pause, getString(if (paused) R.string.rec_resume else R.string.rec_pause)))
            .addAction(action(STOP, R.drawable.ic_stop, getString(if (stopArmed) R.string.rec_stopConfirm else R.string.rec_stop)))
        if (!paused) builder.setUsesChronometer(true).setShowWhen(true).setWhen(store.runStartedAt)
        if (Build.VERSION.SDK_INT >= 31) builder.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
        return builder.build()
    }

    private fun action(what: String, icon: Int, label: String) = Notification.Action.Builder(
        Icon.createWithResource(this, icon), label,
        PendingIntent.getService(this, what.hashCode(), Intent(this, RecordingService::class.java).setAction(what), PendingIntent.FLAG_IMMUTABLE),
    ).build()

    companion object {
        private const val ID = 1
        private const val CHANNEL = "recording"
        const val MARK = "mark"
        const val PAUSE = "pause"
        const val STOP = "stop"

        fun channel(context: Context) {
            val channel = NotificationChannel(CHANNEL, context.getString(R.string.android_channelName), NotificationManager.IMPORTANCE_LOW)
            channel.description = context.getString(R.string.android_channelText)
            channel.setShowBadge(false)
            context.getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }

        fun start(context: Context) = context.startForegroundService(Intent(context, RecordingService::class.java))
        /** Atura from the app: no second tap. */
        fun stop(context: Context) = context.startService(Intent(context, RecordingService::class.java).setAction(STOP_NOW))
        fun send(context: Context, what: String) = context.startService(Intent(context, RecordingService::class.java).setAction(what))
        internal const val STOP_NOW = "stopNow"
        const val DISCARD = "discard"
    }
}
