package com.lain.player

import android.app.Activity
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Bundle
import android.provider.OpenableColumns
import android.view.KeyEvent
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

class MainActivity : Activity() {

    lateinit var webView: WebView
        private set

    private val prefs by lazy { getSharedPreferences("lain", MODE_PRIVATE) }

    companion object { private const val REQ_AUDIO = 42 }

    /** Open the system file picker for local music. */
    fun pickAudio() {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            type = "audio/*"
            addCategory(Intent.CATEGORY_OPENABLE)
            putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
        }
        startActivityForResult(intent, REQ_AUDIO)
    }

    fun openUrl(url: String) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (e: Exception) {
            toast("Не удалось открыть ссылку")
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQ_AUDIO || resultCode != RESULT_OK || data == null) return

        val clip = data.clipData
        val uris = if (clip != null) {
            (0 until clip.itemCount).map { clip.getItemAt(it).uri }
        } else listOfNotNull(data.data)

        CoroutineScope(Dispatchers.IO).launch {
            val tracks = JSONArray()
            val musicDir = File(filesDir, "music").apply { mkdirs() }
            for ((index, uri) in uris.withIndex()) {
                try {
                    val name = displayName(uri) ?: "track_${System.currentTimeMillis()}_$index.mp3"
                    val safe = name.replace(Regex("[^\\w\\-. ()]"), "_")
                    val dest = File(musicDir, "${System.currentTimeMillis()}_${index}_$safe")
                    contentResolver.openInputStream(uri)?.use { input ->
                        dest.outputStream().use { output -> input.copyTo(output) }
                    } ?: continue

                    var title = dest.nameWithoutExtension
                    var artist = "Локальный файл"
                    var duration = 0
                    try {
                        val mmr = MediaMetadataRetriever()
                        try {
                            mmr.setDataSource(this@MainActivity, uri)
                            mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_TITLE)?.let { if (it.isNotBlank()) title = it }
                            mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ARTIST)?.let { if (it.isNotBlank()) artist = it }
                            mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.let { duration = it.toInt() / 1000 }
                        } finally {
                            mmr.release()
                        }
                    } catch (e: Exception) { /* metadata is optional */ }

                    tracks.put(JSONObject()
                        .put("id", "local_" + System.currentTimeMillis() + "_" + index)
                        .put("title", title)
                        .put("artist", artist)
                        .put("duration", duration)
                        .put("art", "")
                        .put("uri", "file://" + dest.absolutePath)
                        .put("local", true))
                } catch (e: Exception) { /* skip unreadable file */ }
            }
            val payload = JSONObject().put("tracks", tracks).toString()
            runOnUiThread {
                webView.evaluateJavascript("window.__lainLocalFiles(${JSONObject.quote(payload)})", null)
            }
        }
    }

    private fun displayName(uri: Uri): String? {
        return try {
            contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
                if (c.moveToFirst()) c.getString(c.getColumnIndexOrThrow(OpenableColumns.DISPLAY_NAME)) else null
            }
        } catch (e: Exception) { null }
    }

    fun pref(key: String): String = prefs.getString(key, "") ?: ""
    fun putPref(key: String, value: String) = prefs.edit().putString(key, value).apply()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = Color.parseColor("#4E342E")
        window.navigationBarColor = Color.parseColor("#3E2723")

        webView = WebView(this).apply {
            layoutParams = android.view.ViewGroup.LayoutParams(
                android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                android.view.ViewGroup.LayoutParams.MATCH_PARENT
            )
            setBackgroundColor(Color.parseColor("#3E2723"))
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                allowFileAccess = true
                allowContentAccess = true
                mediaPlaybackRequiresUserGesture = false
                loadsImagesAutomatically = true
                cacheMode = WebSettings.LOAD_DEFAULT
                @Suppress("DEPRECATION")
                setAllowFileAccessFromFileURLs(true)
            }
            webViewClient = WebViewClient()
            addJavascriptInterface(JsBridge(this@MainActivity), "AndroidBridge")
        }
        setContentView(webView)
        webView.loadUrl("file:///android_asset/web/index.html")
    }

    fun eval(js: String) {
        runOnUiThread { webView.evaluateJavascript(js, null) }
    }

    fun toast(text: String) {
        runOnUiThread { Toast.makeText(this, text, Toast.LENGTH_SHORT).show() }
    }

    /** Switch the launcher icon using activity aliases. */
    fun switchIcon(name: String) {
        val names = mapOf(
            "cross" to ".AliasCross",
            "lain" to ".AliasLain",
            "brown" to ".AliasBrown"
        )
        val target = names[name] ?: ".AliasCross"
        val pm = packageManager
        names.values.forEach { suffix ->
            pm.setComponentEnabledSetting(
                ComponentName(this, packageName + suffix),
                PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                PackageManager.DONT_KILL_APP
            )
        }
        pm.setComponentEnabledSetting(
            ComponentName(this, packageName + target),
            PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
            PackageManager.DONT_KILL_APP
        )
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            webView.evaluateJavascript(
                "(function(){var p=document.getElementById('playerSheet');" +
                    "if(p&&p.classList.contains('open')){p.classList.remove('open');return true;}return false;})()"
            ) { result ->
                if (result != "true") {
                    runOnUiThread {
                        if (webView.canGoBack()) webView.goBack()
                        else finish()
                    }
                }
            }
            return true
        }
        return super.onKeyDown(keyCode, event)
    }
}
