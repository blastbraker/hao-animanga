package app.hao.bridge

import kotlinx.serialization.Serializable

@Serializable data class RuntimeStatus(val id: String, val kind: MediaKind, val available: Boolean, val message: String)

interface ExtensionRuntime {
    val id: String
    val kind: MediaKind
    fun status(): RuntimeStatus
}

class SuwayomiRuntime(private val manager: SuwayomiManager?) : ExtensionRuntime {
    override val id = "suwayomi"
    override val kind = MediaKind.MANGA
    override fun status(): RuntimeStatus = try {
        val runtime = manager?.status()
        RuntimeStatus(id, kind, runtime?.running == true, runtime?.message ?: "Not configured")
    } catch (error: Exception) {
        RuntimeStatus(id, kind, false, "Unavailable: ${error.message ?: "connection failed"}")
    }
}

class AniyomiCompatibilityRuntime : ExtensionRuntime {
    override val id = "aniyomi-compat"
    override val kind = MediaKind.ANIME
    override fun status() = RuntimeStatus(id, kind, false, "Compatibility host scaffolded; enable only after fixture-APK conformance and sandbox tests pass")
}
