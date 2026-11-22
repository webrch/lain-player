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
                val url = StringBuilder("https://api.soundcloud.com/search/tracks?q=$q&limit=30")
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
                val url = StringBuilder("https://api.soundcloud.com/tracks/$id/stream")
                if (token.isBlank() && clientId.isNotBlank()) {
                    url.append("?client_id=").append(URLEncoder.encode(clientId, "UTF-8"))
                }
                val request = Request.Builder().url(url.toString()).apply {
                    if (token.isNotBlank()) header("Authorization", "OAuth ${token.trim()}")
                }.build()

                http.newCall(request).execute().use { response ->
                    if (!response.isSuccessful) {
                        throw Exception("Поток недоступен (${response.code}). Возможно, трек недоступен в твоём регионе.")
                    }
                    JSONObject().put("url", response.request.url.toString()).toString()
                }
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

    /** Check the latest GitHub release of the lain-player repository. */
    @JavascriptInterface
    fun checkUpdate(repoSetting: String, cbId: String) {
        CoroutineScope(Dispatchers.IO).launch {
            val json = try {
                val repo = repoSetting.trim().ifBlank { findRepo() }
                if (repo.isBlank()) throw Exception("Репозиторий lain-player не найден — укажи owner/repo в настройках")
                val request = Request.Builder()
                    .url("https://api.github.com/repos/$repo/releases/latest")
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

    private fun findRepo(): String {
        val request = Request.Builder()
            .url("https://api.github.com/search/repositories?q=lain-player+in:name&per_page=5")
            .header("Accept", "application/vnd.github+json")
            .header("User-Agent", "LAIN-Player")
            .build()
        http.newCall(request).execute().use { response ->
            if (!response.isSuccessful) return ""
            val items = JSONObject(response.body?.string().orEmpty()).optJSONArray("items") ?: return ""
            if (items.length() == 0) return ""
            return items.getJSONObject(0).optString("full_name", "")
        }
    }
}
