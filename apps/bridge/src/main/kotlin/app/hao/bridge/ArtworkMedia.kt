package app.hao.bridge

private fun ByteArray.startsWithBytes(vararg signature: Int): Boolean =
    size >= signature.size && signature.indices.all { index -> this[index].toInt() and 0xff == signature[index] }

private fun ByteArray.asAscii(offset: Int, length: Int): String? {
    if (offset < 0 || length < 0 || offset + length > size) return null
    return String(this, offset, length, Charsets.US_ASCII)
}

/**
 * Identifies the raster image formats HAO can safely return to the browser.
 *
 * Some extension artwork proxies return real image bytes with a missing or
 * generic Content-Type header. Checking the bytes keeps those images usable
 * without forwarding HTML, JSON, or active SVG content as artwork.
 */
internal fun detectArtworkContentType(bytes: ByteArray): String? {
    if (bytes.startsWithBytes(0xff, 0xd8, 0xff)) return "image/jpeg"
    if (bytes.startsWithBytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png"
    if (bytes.asAscii(0, 6) in setOf("GIF87a", "GIF89a")) return "image/gif"
    if (bytes.asAscii(0, 4) == "RIFF" && bytes.asAscii(8, 4) == "WEBP") return "image/webp"
    if (bytes.startsWithBytes(0x42, 0x4d)) return "image/bmp"
    if (bytes.startsWithBytes(0x00, 0x00, 0x01, 0x00)) return "image/x-icon"

    if (bytes.asAscii(4, 4) == "ftyp") {
        val brandLimit = minOf(bytes.size, 32)
        for (offset in 8 until brandLimit step 4) {
            if (bytes.asAscii(offset, 4) in setOf("avif", "avis")) return "image/avif"
        }
    }

    return null
}
