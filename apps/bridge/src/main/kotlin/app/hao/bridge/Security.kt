package app.hao.bridge

import java.net.Inet4Address
import java.net.Inet6Address
import java.net.InetAddress
import java.net.URI
import java.security.MessageDigest
import java.util.jar.JarFile

object Security {
    fun validateRemoteHttps(raw: String): URI {
        val uri = URI(raw)
        require(uri.scheme == "https") { "HTTPS is required" }
        require(uri.userInfo == null) { "Credentials in URLs are not allowed" }
        require(uri.host != null) { "A hostname is required" }
        val addresses = InetAddress.getAllByName(uri.host)
        require(addresses.isNotEmpty() && addresses.none(::isPrivate)) { "Private and reserved destinations are not allowed" }
        return uri
    }

    private fun isPrivate(address: InetAddress): Boolean {
        if (address.isAnyLocalAddress || address.isLoopbackAddress || address.isLinkLocalAddress || address.isSiteLocalAddress || address.isMulticastAddress) return true
        return when (address) {
            is Inet4Address -> {
                val b = address.address.map { it.toInt() and 0xff }
                b[0] == 0 || b[0] == 10 || b[0] == 127 || (b[0] == 169 && b[1] == 254) || (b[0] == 172 && b[1] in 16..31) || (b[0] == 192 && b[1] == 168) || b[0] >= 224
            }
            is Inet6Address -> address.hostAddress.startsWith("fc", true) || address.hostAddress.startsWith("fd", true) || address.hostAddress.startsWith("fe80", true)
            else -> true
        }
    }

    fun sha256(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    fun signerFingerprint(apk: java.io.File): String? {
        JarFile(apk, true).use { jar ->
            val buffer = ByteArray(8192)
            val entries = jar.entries()
            while (entries.hasMoreElements()) {
                val entry = entries.nextElement()
                if (entry.isDirectory || entry.name.startsWith("META-INF/")) continue
                jar.getInputStream(entry).use { input -> while (input.read(buffer) != -1) Unit }
                entry.certificates?.firstOrNull()?.encoded?.let { return sha256(it) }
            }
        }
        return null
    }
}
