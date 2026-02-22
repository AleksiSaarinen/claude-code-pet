package com.claudecodepet

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.graphics.PixelFormat
import android.os.Build
import android.os.IBinder
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.view.inputmethod.InputMethodManager

class OverlayService : Service() {

    companion object {
        const val CHANNEL_ID = "pet_overlay_channel"
        const val NOTIFICATION_ID = 1
        var isRunning = false
    }

    private lateinit var windowManager: WindowManager
    private lateinit var webView: WebView
    private lateinit var params: WindowManager.LayoutParams
    private lateinit var prefs: PetPreferences
    private var scrimView: View? = null

    // Collapsed / expanded sizes in dp → px
    private var collapsedW = 150
    private var collapsedH = 165
    private var expandedW = 320
    private var expandedH = 500
    private var isExpanded = false

    // Drag tracking
    private var initialX = 0
    private var initialY = 0
    private var initialTouchX = 0f
    private var initialTouchY = 0f
    private var isDragging = false
    private val dragThreshold = 10

    // Keyboard-aware positioning
    private var preKeyboardY = 0
    private var isKeyboardMode = false

    // Save collapsed position so we can restore on collapse
    private var collapsedX = 0
    private var collapsedY = 0

    override fun onBind(intent: Intent?): IBinder? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate() {
        super.onCreate()
        isRunning = true

        prefs = PetPreferences(this)
        windowManager = getSystemService(WINDOW_SERVICE) as WindowManager

        val density = resources.displayMetrics.density
        collapsedW = (150 * density).toInt()
        collapsedH = (165 * density).toInt()
        expandedW = (320 * density).toInt()
        expandedH = (500 * density).toInt()

        createNotificationChannel()
        startForeground(NOTIFICATION_ID, createNotification())

        setupWebView()
        setupOverlay()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        webView = WebView(this)
        webView.setBackgroundColor(0x00000000) // transparent
        WebView.setWebContentsDebuggingEnabled(true)

        val settings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        settings.mediaPlaybackRequiresUserGesture = false
        settings.useWideViewPort = false
        settings.loadWithOverviewMode = false

        webView.webViewClient = WebViewClient()
        webView.addJavascriptInterface(PetBridge(), "AndroidBridge")
        webView.isFocusable = true
        webView.isFocusableInTouchMode = true

        val url = prefs.getMobileUrl()
        webView.loadUrl(url)
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun setupOverlay() {
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        else
            @Suppress("DEPRECATION")
            WindowManager.LayoutParams.TYPE_PHONE

        params = WindowManager.LayoutParams(
            collapsedW,
            collapsedH,
            type,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                    WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT
        )
        params.gravity = Gravity.TOP or Gravity.START
        params.x = prefs.overlayX
        params.y = prefs.overlayY

        // Collapsed: intercept ALL touches (drag to move, tap to expand)
        // Expanded: pass touches to WebView (scroll, type); touches outside pass through naturally
        webView.setOnTouchListener { _, event ->
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    if (isExpanded) {
                        false
                    } else {
                        initialX = params.x
                        initialY = params.y
                        initialTouchX = event.rawX
                        initialTouchY = event.rawY
                        isDragging = false
                        true // intercept in collapsed mode
                    }
                }
                MotionEvent.ACTION_MOVE -> {
                    if (isExpanded) {
                        false
                    } else {
                        val dx = (event.rawX - initialTouchX).toInt()
                        val dy = (event.rawY - initialTouchY).toInt()
                        if (!isDragging && (Math.abs(dx) > dragThreshold || Math.abs(dy) > dragThreshold)) {
                            isDragging = true
                        }
                        if (isDragging) {
                            params.x = initialX + dx
                            params.y = initialY + dy
                            windowManager.updateViewLayout(webView, params)
                        }
                        true
                    }
                }
                MotionEvent.ACTION_UP -> {
                    if (isExpanded) {
                        false
                    } else if (isDragging) {
                        prefs.overlayX = params.x
                        prefs.overlayY = params.y
                        true
                    } else {
                        // Tap (no drag) → expand
                        webView.evaluateJavascript("setExpanded(true)", null)
                        setExpandedMode(true)
                        true
                    }
                }
                else -> false
            }
        }

        windowManager.addView(webView, params)
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun showScrim() {
        if (scrimView != null) return
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        else
            @Suppress("DEPRECATION")
            WindowManager.LayoutParams.TYPE_PHONE

        val scrim = View(this)
        scrim.setBackgroundColor(0x44000000) // dim background
        scrim.setOnTouchListener { _, event ->
            if (event.actionMasked == MotionEvent.ACTION_DOWN) {
                // Tap on scrim → collapse
                webView.evaluateJavascript("setExpanded(false)", null)
                setExpandedMode(false)
                true
            } else true
        }

        val scrimParams = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.MATCH_PARENT,
            type,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT
        )
        windowManager.addView(scrim, scrimParams)
        // Re-add webView on top so it's above the scrim
        windowManager.removeView(webView)
        windowManager.addView(webView, params)
        scrimView = scrim
    }

    private fun hideScrim() {
        scrimView?.let {
            try { windowManager.removeView(it) } catch (_: Exception) {}
        }
        scrimView = null
    }

    private fun setExpandedMode(expanded: Boolean) {
        isExpanded = expanded
        val display = windowManager.defaultDisplay
        val screenW = display.width
        val screenH = display.height
        if (expanded) {
            // Save collapsed position to restore later
            collapsedX = params.x
            collapsedY = params.y
            params.width = expandedW
            params.height = expandedH
            params.flags = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
            // Center horizontally, position near top (~8% from top)
            params.x = (screenW - expandedW) / 2
            params.y = (screenH * 0.08).toInt()
            // Show scrim behind overlay so tap-outside-to-close works
            showScrim()
        } else {
            // Hide scrim first
            hideScrim()
            params.width = collapsedW
            params.height = collapsedH
            params.flags = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                    WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
            // Restore collapsed position
            params.x = collapsedX
            params.y = collapsedY
        }
        windowManager.updateViewLayout(webView, params)
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                getString(R.string.notification_channel),
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Keeps the pet overlay alive"
                setShowBadge(false)
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }

    private fun createNotification(): Notification {
        val intent = Intent(this, MainActivity::class.java)
        val pendingIntent = PendingIntent.getActivity(
            this, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
                .setContentTitle(getString(R.string.app_name))
                .setContentText(getString(R.string.notification_text))
                .setSmallIcon(R.drawable.ic_pet_notification)
                .setContentIntent(pendingIntent)
                .setOngoing(true)
                .build()
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
                .setContentTitle(getString(R.string.app_name))
                .setContentText(getString(R.string.notification_text))
                .setSmallIcon(R.drawable.ic_pet_notification)
                .setContentIntent(pendingIntent)
                .setOngoing(true)
                .build()
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        isRunning = false
        hideScrim()
        try {
            windowManager.removeView(webView)
        } catch (_: Exception) {}
        webView.destroy()
    }

    private fun setKeyboardMode(visible: Boolean) {
        if (visible == isKeyboardMode) return
        isKeyboardMode = visible
        if (visible) {
            // Remove NOT_FOCUSABLE so keyboard can open, move overlay to top
            preKeyboardY = params.y
            params.y = 0
            params.flags = 0 // no flags = focusable
            params.softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE
        } else {
            // Restore NOT_FOCUSABLE and position
            params.y = preKeyboardY
            params.flags = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
            params.softInputMode = WindowManager.LayoutParams.SOFT_INPUT_STATE_HIDDEN
            if (!isExpanded) {
                params.flags = params.flags or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
            }
        }
        windowManager.updateViewLayout(webView, params)
        if (visible) {
            webView.requestFocus()
            // Force keyboard open after removing FLAG_NOT_FOCUSABLE
            webView.postDelayed({
                val imm = getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager
                imm.showSoftInput(webView, InputMethodManager.SHOW_IMPLICIT)
            }, 100)
        }
    }

    // JS bridge — the web page calls this to resize the overlay and save character
    inner class PetBridge {
        @JavascriptInterface
        fun setExpanded(expanded: Boolean) {
            webView.post { setExpandedMode(expanded) }
        }

        @JavascriptInterface
        fun setCharacter(charId: String) {
            prefs.character = charId
        }

        @JavascriptInterface
        fun getCharacter(): String {
            return prefs.character
        }

        @JavascriptInterface
        fun setKeyboardVisible(visible: Boolean) {
            webView.post { setKeyboardMode(visible) }
        }
    }
}
