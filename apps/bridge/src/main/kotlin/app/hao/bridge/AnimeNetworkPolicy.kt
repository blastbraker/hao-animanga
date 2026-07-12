package app.hao.bridge

import okhttp3.Interceptor
import okhttp3.Response
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardOpenOption
import java.time.Instant
import java.util.concurrent.ConcurrentHashMap

object AnimeNetworkPolicy : Interceptor {
    private val allowedHosts = ConcurrentHashMap.newKeySet<String>()
    @Volatile private var logPath: Path? = null

    fun configure(hosts: Collection<String>, dataRoot: Path) {
        allowedHosts.clear()
        allowedHosts += hosts.map { it.trim().lowercase() }.filter(String::isNotBlank)
        logPath = dataRoot.resolve("extension-network.log")
    }

    fun allowRemoteHttps(rawUrl: String): String {
        val host = ExtensionSecurityManager.validateAndAllowHost(rawUrl)
        allowedHosts += host
        return host
    }

    fun isAllowedHttps(rawUrl: String): Boolean = runCatching {
        val uri = java.net.URI(rawUrl)
        uri.scheme == "https" && uri.host?.lowercase() in allowedHosts
    }.getOrDefault(false)

    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val host = request.url.host.lowercase()
        if (request.url.isHttps && host !in allowedHosts) {
            runCatching { allowRemoteHttps(request.url.toString()) }
        }
        val allowed = request.url.isHttps && host in allowedHosts
        appendEvent(host, allowed)
        require(allowed) { "Extension network host is not approved" }
        return chain.proceed(request)
    }

    @Synchronized private fun appendEvent(host: String, allowed: Boolean) {
        val target = logPath ?: return
        Files.writeString(
            target,
            "${Instant.now()}\t${if (allowed) "ALLOW" else "DENY"}\t$host${System.lineSeparator()}",
            StandardOpenOption.CREATE,
            StandardOpenOption.APPEND,
            StandardOpenOption.WRITE,
        )
    }
}
