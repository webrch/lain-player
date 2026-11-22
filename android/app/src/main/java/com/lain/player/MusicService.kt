package com.lain.player

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Build
import android.os.IBinder
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request

/** Foreground service that publishes a MediaSession for shade and lock-screen controls. */
class MusicService : Service() {

    companion object {
        private const val CHANNEL_ID = "lain_media"
        private const val NOTIFICATION_ID = 1001
        private const val ACTION_PLAY = "com.lain.player.PLAY"
        private const val ACTION_PAUSE = "com.lain.player.PAUSE"
        private const val ACTION_NEXT = "com.lain.player.NEXT"
        private const val ACTION_PREV = "com.lain.player.PREV"

        @Volatile
        var instance: MusicService? = null

        fun ensureStarted(context: Context) {
            val intent = Intent(context, MusicService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }
    }

    private val http = OkHttpClient()
    private lateinit var session: MediaSession
    private var art: Bitmap? = null
    private var title = "LAIN"
    private var artist = "Лейн"
    private var duration = 0L
    private var position = 0L
    private var playing = false
    private var speed = 1f

    override fun onCreate() {
        super.onCreate()
        createChannel()
        instance = this
        session = MediaSession(this, "LAINMediaSession").apply {
            setFlags(MediaSession.FLAG_HANDLES_MEDIA_BUTTONS or MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS)
            isActive = true
            setCallback(object : MediaSession.Callback() {
                override fun onPlay() { PlayerController.play() }
                override fun onPause() { PlayerController.pause() }
                override fun onStop() { PlayerController.pause() }
                override fun onSkipToNext() { PlayerController.next() }
                override fun onSkipToPrevious() { PlayerController.previous() }
                override fun onSeekTo(pos: Long) { PlayerController.seekTo(pos) }
            })
        }
        publish()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_PLAY -> PlayerController.play()
            ACTION_PAUSE -> PlayerController.pause()
            ACTION_NEXT -> PlayerController.next()
            ACTION_PREV -> PlayerController.previous()
        }
        publish()
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        try {
            session.isActive = false
            session.release()
        } catch (e: Exception) { /* already released */ }
        instance = null
        super.onDestroy()
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(CHANNEL_ID, "LAIN Media", NotificationManager.IMPORTANCE_LOW)
            channel.description = "Управление воспроизведением"
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    fun update(
        title: String,
        artist: String,
        artUrl: String,
        durationMs: Long,
        isPlaying: Boolean,
        positionMs: Long,
        playbackSpeed: Float
    ) {
        this.title = title.ifBlank { "LAIN" }
        this.artist = artist.ifBlank { "Лейн" }
        this.duration = durationMs
        this.playing = isPlaying
        this.position = positionMs
        this.speed = playbackSpeed
        PlayerController.isPlaying = isPlaying
        publish()

        if (artUrl.isNotBlank() && artUrl != this.lastArtUrl) {
            this.lastArtUrl = artUrl
            CoroutineScope(Dispatchers.IO).launch {
                val bitmap = decodeArt(artUrl)
                withContext(Dispatchers.Main) {
                    art = bitmap
                    publish()
                }
            }
        }
    }

    private var lastArtUrl = ""

    private fun decodeArt(url: String): Bitmap? = try {
        val options = BitmapFactory.Options().apply { inSampleSize = 2 }
        if (url.startsWith("file://")) {
            BitmapFactory.decodeFile(url.removePrefix("file://"), options)
        } else {
            val request = Request.Builder().url(url).build()
            http.newCall(request).execute().use { response ->
                if (response.isSuccessful) BitmapFactory.decodeStream(response.body?.byteStream(), null, options) else null
            }
        }
    } catch (e: Exception) { null }

    private fun publish() {
        if (!::session.isInitialized) return
        val metadata = MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, title)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, artist)
            .putLong(MediaMetadata.METADATA_KEY_DURATION, duration)
            .apply { art?.let { putBitmap(MediaMetadata.METADATA_KEY_ART, it) } }
            .build()
        session.setMetadata(metadata)

        val state = PlaybackState.Builder()
            .setState(
                if (playing) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED,
                position, speed
            )
            .setActions(
                PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or
                    PlaybackState.ACTION_SKIP_TO_NEXT or PlaybackState.ACTION_SKIP_TO_PREVIOUS or
                    PlaybackState.ACTION_SEEK_TO
            )
            .build()
        session.setPlaybackState(state)

        val notification = buildNotification()
        try {
            startForeground(NOTIFICATION_ID, notification)
        } catch (e: Exception) {
            getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, notification)
        }
    }

    private fun action(icon: Int, label: String, action: String, requestCode: Int): Notification.Action {
        val intent = Intent(this, MusicService::class.java).setAction(action)
        val pending = PendingIntent.getService(
            this, requestCode, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        return Notification.Action.Builder(icon, label, pending).build()
    }

    private fun buildNotification(): Notification {
        val open = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pendingOpen = PendingIntent.getActivity(
            this, 0, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }
        return builder
            .setSmallIcon(R.drawable.ic_stat_music)
            .setContentTitle(title)
            .setContentText(artist)
            .setContentIntent(pendingOpen)
            .setLargeIcon(art)
            .setOnlyAlertOnce(true)
            .setOngoing(true)
            .addAction(action(android.R.drawable.ic_media_previous, "Prev", ACTION_PREV, 1))
            .addAction(
                action(
                    if (playing) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play,
                    if (playing) "Pause" else "Play",
                    if (playing) ACTION_PAUSE else ACTION_PLAY, 2
                )
            )
            .addAction(action(android.R.drawable.ic_media_next, "Next", ACTION_NEXT, 3))
            .setStyle(
                Notification.MediaStyle()
                    .setMediaSession(session.sessionToken)
                    .setShowActionsInCompactView(0, 1, 2)
            )
            .build()
    }
}
