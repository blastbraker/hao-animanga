package app.hao.bridge

import kotlinx.serialization.Serializable

@Serializable data class HealthResponse(val status: String, val version: String, val paired: Boolean)
@Serializable data class PairRequest(val code: String, val accountId: String, val deviceName: String)
@Serializable data class PairResponse(val deviceId: String, val publicKey: String, val pairedAt: String)
@Serializable data class RepositoryRequest(val url: String, val mediaKind: MediaKind, val acknowledged: Boolean)
@Serializable data class RepositoryPreview(val name: String, val url: String, val mediaKind: MediaKind, val packages: List<ExtensionPackage>, val warnings: List<String>)
@Serializable data class ExtensionPackage(val name: String, val pkg: String, val apk: String, val version: String, val language: String? = null, val nsfw: Int? = null)
@Serializable data class InspectExtensionRequest(val repositoryUrl: String, val mediaKind: MediaKind, val packageInfo: ExtensionPackage, val acknowledged: Boolean)
@Serializable data class ExtensionInspection(
    val id: String,
    val packageName: String,
    val displayName: String,
    val mediaKind: MediaKind,
    val version: String,
    val sha256: String,
    val signerFingerprint: String,
    val previousSignerFingerprint: String? = null,
    val signerChanged: Boolean,
    val permissions: List<String>,
    val previousPermissions: List<String> = emptyList(),
    val permissionsChanged: Boolean,
    val byteSize: Long,
    val maturity: String,
    val expiresAt: String,
)
@Serializable data class ConfirmInstallRequest(
    val inspectionId: String,
    val acknowledged: Boolean,
    val acceptPermissions: Boolean,
    val acceptSignerChange: Boolean = false,
)
@Serializable data class ExtensionStateRequest(val mediaKind: MediaKind, val packageName: String, val enabled: Boolean)
@Serializable data class RemoveExtensionRequest(val mediaKind: MediaKind, val packageName: String)
@Serializable data class ExtensionRemovalResponse(val packageName: String, val removed: Boolean)
@Serializable data class InstalledPackage(
    val packageName: String,
    val displayName: String,
    val mediaKind: MediaKind,
    val version: String,
    val sha256: String,
    val signerFingerprint: String,
    val permissions: List<String>,
    val byteSize: Long,
    val maturity: String,
    val localPath: String,
    val installedAt: String,
    val enabled: Boolean,
)
@Serializable enum class MediaKind { ANIME, MANGA }
@Serializable data class ErrorResponse(val code: String, val message: String, val retryable: Boolean = false)

const val DISCLAIMER = "Third-party repositories and extensions are not created, reviewed, hosted, endorsed, supported, or controlled by HAO. Their developers and content providers are unaffiliated with HAO. Availability, safety, and legality are not guaranteed. You are responsible for using only content you are authorized to access and for complying with applicable laws and provider terms."
