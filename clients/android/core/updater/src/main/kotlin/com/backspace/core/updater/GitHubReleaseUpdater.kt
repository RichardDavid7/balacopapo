package com.backspace.core.updater

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request

@Serializable
data class GitHubAssetDto(
    val name: String = "",
    @SerialName("browser_download_url")
    val downloadUrl: String = "",
)

@Serializable
data class GitHubReleaseDto(
    @SerialName("tag_name")
    val tagName: String = "",
    val name: String = "",
    @SerialName("html_url")
    val htmlUrl: String = "",
    val assets: List<GitHubAssetDto> = emptyList(),
)

data class UpdateCheckResult(
    val currentVersion: String,
    val latestTag: String,
    val updateAvailable: Boolean,
    val downloadUrl: String,
)

class GitHubReleaseUpdater(
    private val okHttpClient: OkHttpClient,
    private val json: Json = Json { ignoreUnknownKeys = true },
) {
    suspend fun checkLatestRelease(
        repoSlug: String,
        currentVersion: String,
    ): UpdateCheckResult? = withContext(Dispatchers.IO) {
        if (repoSlug.isBlank()) return@withContext null
        val request = Request.Builder()
            .url("https://api.github.com/repos/$repoSlug/releases/latest")
            .header("Accept", "application/vnd.github+json")
            .get()
            .build()

        runCatching {
            okHttpClient.newCall(request).execute().use { resp ->
                if (!resp.isSuccessful) return@use null
                val raw = resp.body?.string().orEmpty()
                val dto = json.decodeFromString(GitHubReleaseDto.serializer(), raw)
                val apkAsset = dto.assets.firstOrNull { it.name.endsWith(".apk", ignoreCase = true) }

                UpdateCheckResult(
                    currentVersion = currentVersion,
                    latestTag = dto.tagName,
                    updateAvailable = isNewerVersion(dto.tagName, currentVersion),
                    downloadUrl = apkAsset?.downloadUrl?.ifBlank { dto.htmlUrl } ?: dto.htmlUrl,
                )
            }
        }.getOrNull()
    }

    companion object {
        private data class SemVer(
            val major: Int,
            val minor: Int,
            val patch: Int,
            val preRelease: List<String>,
        ) : Comparable<SemVer> {
            override fun compareTo(other: SemVer): Int {
                if (major != other.major) return major.compareTo(other.major)
                if (minor != other.minor) return minor.compareTo(other.minor)
                if (patch != other.patch) return patch.compareTo(other.patch)

                val thisStable = preRelease.isEmpty()
                val otherStable = other.preRelease.isEmpty()
                if (thisStable && otherStable) return 0
                if (thisStable) return 1
                if (otherStable) return -1

                val maxLen = maxOf(preRelease.size, other.preRelease.size)
                for (i in 0 until maxLen) {
                    val a = preRelease.getOrNull(i) ?: return -1
                    val b = other.preRelease.getOrNull(i) ?: return 1
                    val aNum = a.toIntOrNull()
                    val bNum = b.toIntOrNull()
                    val cmp = when {
                        aNum != null && bNum != null -> aNum.compareTo(bNum)
                        aNum != null -> -1
                        bNum != null -> 1
                        else -> comparePreReleaseTag(a, b)
                    }
                    if (cmp != 0) return cmp
                }
                return 0
            }
        }

        private fun comparePreReleaseTag(a: String, b: String): Int {
            val rankA = preReleaseRank(a)
            val rankB = preReleaseRank(b)
            if (rankA != rankB) return rankA.compareTo(rankB)
            return a.lowercase().compareTo(b.lowercase())
        }

        private fun preReleaseRank(tag: String): Int = when (tag.lowercase()) {
            "alpha", "a" -> 1
            "beta", "b" -> 2
            "rc" -> 3
            else -> 4
        }

        private fun parseSemVer(raw: String): SemVer? {
            val cleaned = raw.trim()
                .removePrefix("v")
                .removePrefix("V")
                .substringBefore('+')
                .trim()
            if (cleaned.isEmpty()) return null

            val dashIdx = cleaned.indexOf('-')
            val corePart = if (dashIdx >= 0) cleaned.substring(0, dashIdx) else cleaned
            val prePart = if (dashIdx >= 0) cleaned.substring(dashIdx + 1) else ""

            val nums = corePart.split('.')
            if (nums.isEmpty()) return null
            val major = nums[0].toIntOrNull() ?: return null
            val minor = nums.getOrNull(1)?.toIntOrNull() ?: 0
            val patch = nums.getOrNull(2)?.toIntOrNull() ?: 0

            val preIdentifiers = if (prePart.isBlank()) {
                emptyList()
            } else {
                prePart.split('.', '-').filter { it.isNotBlank() }
            }
            return SemVer(major, minor, patch, preIdentifiers)
        }

        /**
         * Compara versões SemVer reais (removendo prefixo `v`, comparando `major.minor.patch`
         * numericamente e tratando pre-releases `-alpha`, `-beta`, `-rc`).
         * Retorna `true` somente se `remoteTag` for estritamente mais nova que `currentVersion`.
         */
        fun isNewerVersion(remoteTag: String, currentVersion: String): Boolean {
            val remote = parseSemVer(remoteTag) ?: return false
            val current = parseSemVer(currentVersion) ?: return false
            return remote > current
        }
    }
}
