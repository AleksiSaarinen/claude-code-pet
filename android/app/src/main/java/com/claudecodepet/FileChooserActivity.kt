package com.claudecodepet

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.util.Base64
import android.webkit.ValueCallback
import android.webkit.WebChromeClient

class FileChooserActivity : Activity() {

    companion object {
        private const val FILE_CHOOSER_REQUEST = 3001
        var fileCallback: ValueCallback<Array<Uri>>? = null
        var directMode = false // true = bypass WebView, read file and pass to JS
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        if (directMode) {
            // Direct mode — launch image picker without WebChromeClient
            val pickIntent = Intent(Intent.ACTION_GET_CONTENT).apply {
                type = "image/*"
                addCategory(Intent.CATEGORY_OPENABLE)
            }
            startActivityForResult(Intent.createChooser(pickIntent, "Select Image"), FILE_CHOOSER_REQUEST)
        } else {
            val chooserIntent = intent.getParcelableExtra<Intent>("chooser_intent")
            if (chooserIntent != null) {
                startActivityForResult(chooserIntent, FILE_CHOOSER_REQUEST)
            } else {
                fileCallback?.onReceiveValue(null)
                fileCallback = null
                finish()
            }
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == FILE_CHOOSER_REQUEST) {
            if (directMode) {
                handleDirectResult(resultCode, data)
            } else {
                if (resultCode == RESULT_OK && data != null) {
                    val result = WebChromeClient.FileChooserParams.parseResult(resultCode, data)
                    fileCallback?.onReceiveValue(result)
                } else {
                    fileCallback?.onReceiveValue(null)
                }
                fileCallback = null
            }
        }
        // Restore the overlay
        OverlayService.instance?.restoreAfterFilePicker()
        finish()
    }

    private fun handleDirectResult(resultCode: Int, data: Intent?) {
        directMode = false
        if (resultCode != RESULT_OK || data?.data == null) return

        val uri = data.data ?: return
        try {
            val mimeType = contentResolver.getType(uri) ?: "image/png"
            val inputStream = contentResolver.openInputStream(uri) ?: return
            val bytes = inputStream.readBytes()
            inputStream.close()

            if (bytes.size > 10 * 1024 * 1024) return // 10MB limit

            val base64 = Base64.encodeToString(bytes, Base64.NO_WRAP)

            // Get filename from URI
            var fileName = "image"
            val cursor = contentResolver.query(uri, null, null, null, null)
            cursor?.use {
                if (it.moveToFirst()) {
                    val nameIndex = it.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
                    if (nameIndex >= 0) fileName = it.getString(nameIndex)
                }
            }

            // Pass file data back to JS
            val js = "window._onAndroidFilePicked && window._onAndroidFilePicked(" +
                    "\"${escapeJs(fileName)}\", \"${escapeJs(mimeType)}\", \"$base64\", ${bytes.size})"
            OverlayService.instance?.evaluateJs(js)
        } catch (e: Exception) {
            // silently fail
        }
    }

    private fun escapeJs(s: String): String {
        return s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n")
    }
}
