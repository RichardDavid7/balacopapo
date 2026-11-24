package com.backspace.core.network

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

data class StoredSession(
    val instanceUrl: String,
    val token: String,
)

class SecureSessionStorage(context: Context) {
    private val masterKey = MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()

    private val prefs = EncryptedSharedPreferences.create(
        context,
        "backspace_secure_session",
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    fun save(instanceUrl: String, token: String) {
        prefs.edit()
            .putString(KEY_INSTANCE_URL, normalizeInstanceUrl(instanceUrl))
            .putString(KEY_TOKEN, token)
            .apply()
    }

    fun load(): StoredSession? {
        val url = prefs.getString(KEY_INSTANCE_URL, null) ?: return null
        val token = prefs.getString(KEY_TOKEN, null) ?: return null
        if (url.isBlank() || token.isBlank()) return null
        return StoredSession(instanceUrl = url, token = token)
    }

    fun clear() {
        prefs.edit().clear().apply()
    }

    companion object {
        private const val KEY_INSTANCE_URL = "instance_url"
        private const val KEY_TOKEN = "jwt_token"

        fun normalizeInstanceUrl(raw: String): String {
            val trimmed = raw.trim().trimEnd('/')
            return if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
                trimmed
            } else {
                "https://$trimmed"
            }
        }
    }
}
