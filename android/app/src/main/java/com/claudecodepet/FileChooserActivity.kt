package com.claudecodepet

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.webkit.ValueCallback
import android.webkit.WebChromeClient

class FileChooserActivity : Activity() {

    companion object {
        private const val FILE_CHOOSER_REQUEST = 3001
        var fileCallback: ValueCallback<Array<Uri>>? = null
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val chooserIntent = intent.getParcelableExtra<Intent>("chooser_intent")
        if (chooserIntent != null) {
            startActivityForResult(chooserIntent, FILE_CHOOSER_REQUEST)
        } else {
            fileCallback?.onReceiveValue(null)
            fileCallback = null
            finish()
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == FILE_CHOOSER_REQUEST) {
            if (resultCode == RESULT_OK && data != null) {
                val result = WebChromeClient.FileChooserParams.parseResult(resultCode, data)
                fileCallback?.onReceiveValue(result)
            } else {
                fileCallback?.onReceiveValue(null)
            }
            fileCallback = null
        }
        // Restore the overlay
        OverlayService.instance?.restoreAfterFilePicker()
        finish()
    }
}
