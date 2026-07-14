package app.hao.bridge

import java.net.Inet4Address
import java.net.Inet6Address
import java.net.InetAddress
import java.net.URI
import java.security.MessageDigest
import java.nio.file.Files
import java.nio.file.Path

object Security {
    fun secretsMatch(expected: String, provided: String?): Boolean {
        if (provided == null) return false
        return MessageDigest.isEqual(expected.encodeToByteArray(), provided.encodeToByteArray())
    }

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
        }
    }

    fun sha256(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    fun sha256(path: Path): String {
        val digest = MessageDigest.getInstance("SHA-256")
        Files.newInputStream(path).use { input ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val read = input.read(buffer)
                if (read == -1) break
                digest.update(buffer, 0, read)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

}
