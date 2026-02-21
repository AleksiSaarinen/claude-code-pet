package com.claudecodepet

import android.content.Context
import android.content.SharedPreferences

class PetPreferences(context: Context) {
    private val prefs: SharedPreferences =
        context.getSharedPreferences("claude_code_pet", Context.MODE_PRIVATE)

    var serverUrl: String
        get() = prefs.getString("server_url", "") ?: ""
        set(value) = prefs.edit().putString("server_url", value).apply()

    var token: String
        get() = prefs.getString("token", "") ?: ""
        set(value) = prefs.edit().putString("token", value).apply()

    var character: String
        get() = prefs.getString("character", "pixel-claude") ?: "pixel-claude"
        set(value) = prefs.edit().putString("character", value).apply()

    var overlayX: Int
        get() = prefs.getInt("overlay_x", 0)
        set(value) = prefs.edit().putInt("overlay_x", value).apply()

    var overlayY: Int
        get() = prefs.getInt("overlay_y", 200)
        set(value) = prefs.edit().putInt("overlay_y", value).apply()

    fun getMobileUrl(): String {
        val base = serverUrl.trimEnd('/')
        return "$base/mobile?token=$token&char=$character"
    }
}
