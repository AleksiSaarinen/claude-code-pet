package com.claudecodepet

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.google.android.material.button.MaterialButton
import com.google.android.material.textfield.TextInputEditText

class MainActivity : AppCompatActivity() {

    private lateinit var prefs: PetPreferences
    private lateinit var urlInput: TextInputEditText
    private lateinit var tokenInput: TextInputEditText
    private lateinit var startBtn: MaterialButton
    private lateinit var stopBtn: MaterialButton
    private lateinit var permissionBtn: MaterialButton

    companion object {
        private const val OVERLAY_PERMISSION_CODE = 1001
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        prefs = PetPreferences(this)

        urlInput = findViewById(R.id.urlInput)
        tokenInput = findViewById(R.id.tokenInput)
        startBtn = findViewById(R.id.startBtn)
        stopBtn = findViewById(R.id.stopBtn)
        permissionBtn = findViewById(R.id.permissionBtn)

        // Restore saved values
        urlInput.setText(prefs.serverUrl)
        tokenInput.setText(prefs.token)

        permissionBtn.setOnClickListener {
            requestOverlayPermission()
        }

        startBtn.setOnClickListener {
            if (!Settings.canDrawOverlays(this)) {
                Toast.makeText(this, "Overlay permission required", Toast.LENGTH_SHORT).show()
                requestOverlayPermission()
                return@setOnClickListener
            }

            val url = urlInput.text?.toString()?.trim() ?: ""
            val token = tokenInput.text?.toString()?.trim() ?: ""

            if (url.isEmpty() || token.isEmpty()) {
                Toast.makeText(this, "Enter server URL and token", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }

            prefs.serverUrl = url
            prefs.token = token

            startOverlayService()
        }

        stopBtn.setOnClickListener {
            stopOverlayService()
        }

        updateUI()
    }

    override fun onResume() {
        super.onResume()
        updateUI()
    }

    private fun updateUI() {
        val hasPermission = Settings.canDrawOverlays(this)
        permissionBtn.isEnabled = !hasPermission
        permissionBtn.text = if (hasPermission) "Permission granted" else getString(R.string.overlay_permission)
        startBtn.isEnabled = hasPermission

        val running = OverlayService.isRunning
        startBtn.isEnabled = hasPermission && !running
        stopBtn.isEnabled = running
    }

    private fun requestOverlayPermission() {
        val intent = Intent(
            Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
            Uri.parse("package:$packageName")
        )
        startActivityForResult(intent, OVERLAY_PERMISSION_CODE)
    }

    @Deprecated("Use ActivityResult API")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == OVERLAY_PERMISSION_CODE) {
            updateUI()
            if (Settings.canDrawOverlays(this)) {
                Toast.makeText(this, "Overlay permission granted!", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun startOverlayService() {
        val intent = Intent(this, OverlayService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(intent)
        } else {
            startService(intent)
        }
        OverlayService.isRunning = true
        Toast.makeText(this, "Pet overlay started", Toast.LENGTH_SHORT).show()
        updateUI()
    }

    private fun stopOverlayService() {
        val intent = Intent(this, OverlayService::class.java)
        stopService(intent)
        OverlayService.isRunning = false
        Toast.makeText(this, "Pet overlay stopped", Toast.LENGTH_SHORT).show()
        updateUI()
    }
}
