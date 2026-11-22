package com.lain.player

import android.webkit.WebView

/** Process-wide link between the media session/service and the WebView player. */
object PlayerController {
    @Volatile
    private var webView: WebView? = null

    @Volatile
    var isPlaying: Boolean = false

    fun attach(view: WebView) {
        webView = view
    }

    fun detach(view: WebView) {
        if (webView === view) webView = null
    }

    private fun call(script: String) {
        webView?.post {
            webView?.evaluateJavascript(script, null)
        }
    }

    fun play() = call("window.__lainMediaControl && window.__lainMediaControl('play')")
    fun pause() = call("window.__lainMediaControl && window.__lainMediaControl('pause')")
    fun toggle() = call("window.__lainMediaControl && window.__lainMediaControl('toggle')")
    fun next() = call("window.__lainMediaControl && window.__lainMediaControl('next')")
    fun previous() = call("window.__lainMediaControl && window.__lainMediaControl('prev')")
    fun seekTo(ms: Long) = call("window.__lainMediaControl && window.__lainMediaControl('seek', $ms)")
}
