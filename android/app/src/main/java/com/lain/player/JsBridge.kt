package com.lain.player

import android.annotation.SuppressLint
import android.app.WallpaperManager
import android.webkit.JavascriptInterface
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder

/** Bridge between the WebView UI and native Android capabilities. */
class JsBridge(private val activity: MainActivity) {

    private val http = OkHttpClient()

    @JavascriptInterface
    fun getSetting(key: String): String = activity.pref(key)

    @JavascriptInterface
    fun setSetting(key: String, value: String) = activity.putPref(key, value)

    @JavascriptInterface
    @SuppressLint("MissingPermission")
    fun setIcon(name: String) {
        activity.runOnUiThread { activity.switchIcon(name) }
    }

    @JavascriptInterface
    fun setSystemWallpaper(name: String) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val file = when (name) {
                    "1" -> "wallpaper/1.jpg"
                    "2" -> "wallpaper/2.jpg"
                    else -> "wallpaper/default.jpg"
                }
                activity.assets.open("web/assets/$file").use { input ->
                    WallpaperManager.getInstance(activity).setStream(input)
                }
                activity.toast("Обои установлены на рабочий стол")
            } catch (e: Exception) {
                activity.toast("Не удалось установить обои: ${e.message}")
            }
        }
    }

    @JavascriptInterface
    fun search(query: String, token: String, clientId: String, cbId: String) {
        CoroutineScope(Dispatchers.IO).launch {
            val json = try {
                val q = URLEncoder.encode(query, "UTF-8")
                val url = StringBuilder("https://api-v2.soundcloud.com/search/tracks?q=$q&limit=30")
                if (clientId.isNotBlank()) {
                    url.append("&client_id=").append(URLEncoder.encode(clientId, "UTF-8"))
                }
                val request = Request.Builder().url(url.toString()).apply {
                    if (token.isNotBlank()) header("Authorization", "OAuth ${token.trim()}")
                }.build()

                http.newCall(request).execute().use { response ->
                    val body = response.body?.string().orEmpty()
                    if (!response.isSuccessful) {
                        throw Exception("SoundCloud API: HTTP ${response.code}. Проверь токен.")
                    }
                    val root = JSONObject(body)
                    val collection: JSONArray = when {
                        root.has("collection") -> root.getJSONArray("collection")
                        else -> throw Exception("Неожиданный ответ SoundCloud")
                    }
                    val items = JSONArray()
                    for (i in 0 until collection.length()) {
                        val t = collection.getJSONObject(i)
                        val user = t.optJSONObject("user")
                        items.put(JSONObject()
                            .put("id", t.optLong("id"))
                            .put("title", t.optString("title", "Без названия"))
                            .put("duration", t.optLong("duration", 0))
                            .put("artwork_url", t.optString("artwork_url", ""))
                            .put("uri", t.optString("uri", ""))
                            .put("likes_count", t.optInt("likes_count", 0))
                            .put("genre", t.optString("genre", ""))
                            .put("user", JSONObject().put("username", user?.optString("username", "Неизвестный") ?: "Неизвестный")))
                    }
                    JSONObject().put("items", items).toString()
                }
            } catch (e: Exception) {
                JSONObject().put("error", e.message ?: "Ошибка поиска").toString()
            }
            activity.eval("window.__lainCb('$cbId', ${JSONObject.quote(json)})")
        }
    }

    @JavascriptInterface
    fun resolveStream(id: String, token: String, clientId: String, cbId: String) {
        CoroutineScope(Dispatchers.IO).launch {
            val json = try {
                if (id.isBlank()) throw Exception("Нет ID трека")
                val hasToken = token.isNotBlank()
                val clientPart = if (clientId.isNotBlank())
                    "?client_id=" + URLEncoder.encode(clientId, "UTF-8") else ""

                val trackRequest = Request.Builder()
                    .url("https://api-v2.soundcloud.com/tracks/$id$clientPart")
                    .apply { if (hasToken) header("Authorization", "OAuth ${token.trim()}") }
                    .build()
                val track = http.newCall(trackRequest).execute().use { response ->
                    if (!response.isSuccessful) throw Exception("Трек недоступен (${response.code}). Проверь токен.")
                    JSONObject(response.body?.string().orEmpty())
                }

                val transcodings = track.optJSONObject("media")?.optJSONArray("transcodings")
                    ?: throw Exception("У трека нет доступного потока")
                var best = transcodings.getJSONObject(0)
                var bestScore = -1
                for (i in 0 until transcodings.length()) {
                    val item = transcodings.getJSONObject(i)
                    val score = when (item.optString("preset", "")) {
                        "aac_160k" -> 2
                        else -> if (item.optString("quality", "") == "sq") 1 else 0
                    }
                    if (score > bestScore) { bestScore = score; best = item }
                }

                var mediaUrl = best.optString("url")
                if (clientId.isNotBlank()) {
                    mediaUrl += (if (mediaUrl.contains("?")) "&" else "?") +
                        "client_id=" + URLEncoder.encode(clientId, "UTF-8")
                }
                val mediaRequest = Request.Builder().url(mediaUrl)
                    .apply { if (hasToken) header("Authorization", "OAuth ${token.trim()}") }
                    .build()
                val streamUrl = http.newCall(mediaRequest).execute().use { response ->
                    if (!response.isSuccessful) throw Exception("Поток недоступен (${response.code})")
                    JSONObject(response.body?.string().orEmpty()).optString("url", "")
                }
                if (streamUrl.isBlank()) throw Exception("Не удалось получить ссылку на поток")
                JSONObject().put("url", streamUrl).toString()
            } catch (e: Exception) {
                JSONObject().put("error", e.message ?: "Не удалось получить поток").toString()
            }
            activity.eval("window.__lainCb('$cbId', ${JSONObject.quote(json)})")
        }
    }

    @JavascriptInterface
    fun pickAudio() {
        activity.runOnUiThread { activity.pickAudio() }
    }

    @JavascriptInterface
    fun openUrl(url: String) {
        activity.openUrl(url)
    }

    /** Update source is fixed in the app and cannot be changed from the UI. */
    @JavascriptInterface
    fun checkUpdate(cbId: String) {
        CoroutineScope(Dispatchers.IO).launch {
            val json = try {
                val request = Request.Builder()
                    .url("https://api.github.com/repos/webrch/lain-player/releases/latest")
                    .header("Accept", "application/vnd.github+json")
                    .header("User-Agent", "LAIN-Player")
                    .build()
                http.newCall(request).execute().use { response ->
                    if (response.code == 404) {
                        JSONObject().put("version", "").toString()
                    } else {
                        if (!response.isSuccessful) throw Exception("GitHub: HTTP ${response.code}")
                        val release = JSONObject(response.body?.string().orEmpty())
                        var apk = ""
                        val assets = release.optJSONArray("assets")
                        if (assets != null) {
                            for (i in 0 until assets.length()) {
                                val asset = assets.getJSONObject(i)
                                if (asset.optString("name", "").endsWith(".apk")) {
                                    apk = asset.optString("browser_download_url", "")
                                    break
                                }
                            }
                        }
                        JSONObject()
                            .put("version", release.optString("tag_name", ""))
                            .put("url", release.optString("html_url", ""))
                            .put("apk", apk)
                            .put("notes", release.optString("body", ""))
                            .toString()
                    }
                }
            } catch (e: Exception) {
                JSONObject().put("error", e.message ?: "Ошибка проверки обновлений").toString()
            }
            activity.eval("window.__lainCb('$cbId', ${JSONObject.quote(json)})")
        }
    }

    @JavascriptInterface
    fun updateMedia(
        title: String,
        artist: String,
        artUrl: String,
        durationMs: Long,
        isPlaying: Boolean,
        positionMs: Long,
        playbackSpeed: Float
    ) {
        activity.runOnUiThread {
            try {
                MusicService.ensureStarted(activity)
                val handler = android.os.Handler(android.os.Looper.getMainLooper())
                var attempts = 0
                fun push() {
                    val service = MusicService.instance
                    if (service != null) {
                        service.update(title, artist, artUrl, durationMs, isPlaying, positionMs, playbackSpeed)
                    } else if (attempts++ < 10) {
                        handler.postDelayed({ push() }, 150)
                    }
                }
                push()
            } catch (e: Exception) { /* notification permission may be denied */ }
        }
    }

    @JavascriptInterface
    fun stopMedia() {
        activity.runOnUiThread {
            try { activity.stopService(android.content.Intent(activity, MusicService::class.java)) }
            catch (e: Exception) { /* ignore */ }
        }
    }

    private fun getJson(url: String, token: String): JSONObject {
        val request = Request.Builder()
            .url(url)
            .header("Authorization", "OAuth ${token.trim()}")
            .header("Accept", "application/json")
            .header("User-Agent", "LAIN-Player")
            .build()
        http.newCall(request).execute().use { response ->
            if (!response.isSuccessful) throw Exception("SoundCloud: HTTP ${response.code}")
            return JSONObject(response.body?.string().orEmpty())
        }
    }

    private fun scTrack(t: JSONObject): JSONObject {
        val user = t.optJSONObject("user")
        return JSONObject()
            .put("id", t.optLong("id"))
            .put("title", t.optString("title", "Без названия"))
            .put("duration", t.optLong("duration", 0))
            .put("artwork_url", t.optString("artwork_url", ""))
            .put("uri", t.optString("uri", ""))
            .put("likes_count", t.optInt("likes_count", 0))
            .put("genre", t.optString("genre", ""))
            .put("user", JSONObject().put("username", user?.optString("username", "Неизвестный") ?: "Неизвестный"))
    }

    /** Import liked tracks and playlists from the signed-in SoundCloud profile. */
    @JavascriptInterface
    fun importFromSoundCloud(kind: String, token: String, clientId: String, cbId: String) {
        CoroutineScope(Dispatchers.IO).launch {
            val json = try {
                if (token.isBlank()) throw Exception("Сначала укажи токен")
                val client = if (clientId.isNotBlank()) "&client_id=" + URLEncoder.encode(clientId, "UTF-8") else ""
                val me = getJson("https://api-v2.soundcloud.com/me", token)
                val uid = me.optLong("id")
                val result = JSONObject()
                val allTracks = JSONArray()
                val allPlaylists = JSONArray()

                var page: String? = "https://api-v2.soundcloud.com/users/$uid/" +
                    (if (kind == "likes") "track_likes?limit=200$client" else "playlists?limit=200$client")
                var pages = 0
                while (page != null && pages < 5) {
                    val data = getJson(page, token)
                    val collection = data.optJSONArray("collection") ?: break
                    for (i in 0 until collection.length()) {
                        val item = collection.optJSONObject(i) ?: continue
                        if (kind == "likes") {
                            item.optJSONObject("track")?.let { allTracks.put(scTrack(it)) }
                        } else {
                            val playlist = JSONObject()
                                .put("id", item.optLong("id"))
                                .put("title", item.optString("title", "Плейлист SoundCloud"))
                            val tracks = JSONArray()
                            val source = item.optJSONArray("tracks") ?: JSONArray()
                            for (j in 0 until source.length()) {
                                source.optJSONObject(j)?.let { tracks.put(scTrack(it)) }
                            }
                            playlist.put("tracks", tracks)
                            allPlaylists.put(playlist)
                        }
                    }
                    page = data.optString("next_href", "").takeIf { it.isNotBlank() }
                    pages++
                }
                if (kind == "likes") result.put("items", allTracks) else result.put("playlists", allPlaylists)
                result.toString()
            } catch (e: Exception) {
                JSONObject().put("error", e.message ?: "Ошибка импорта").toString()
            }
            activity.eval("window.__lainCb('$cbId', ${JSONObject.quote(json)})")
        }
    }
}
