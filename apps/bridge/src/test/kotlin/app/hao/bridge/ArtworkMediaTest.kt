package app.hao.bridge

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class ArtworkMediaTest {
    @Test
    fun `detects common raster image signatures`() {
        assertEquals("image/jpeg", detectArtworkContentType(byteArrayOf(0xff.toByte(), 0xd8.toByte(), 0xff.toByte(), 0x00)))
        assertEquals(
            "image/png",
            detectArtworkContentType(byteArrayOf(0x89.toByte(), 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)),
        )
        assertEquals("image/gif", detectArtworkContentType("GIF89a image".toByteArray()))
        assertEquals("image/webp", detectArtworkContentType("RIFF0000WEBP".toByteArray()))
        assertEquals("image/bmp", detectArtworkContentType(byteArrayOf(0x42, 0x4d, 0x00)))
        assertEquals("image/x-icon", detectArtworkContentType(byteArrayOf(0x00, 0x00, 0x01, 0x00)))
    }

    @Test
    fun `detects AVIF brands in ISO base media files`() {
        assertEquals("image/avif", detectArtworkContentType("0000ftypavif0000".toByteArray()))
        assertEquals("image/avif", detectArtworkContentType("0000ftypmif1avif".toByteArray()))
    }

    @Test
    fun `rejects HTML and active SVG responses`() {
        assertNull(detectArtworkContentType("<html>not artwork</html>".toByteArray()))
        assertNull(detectArtworkContentType("<svg onload=\"alert(1)\"></svg>".toByteArray()))
    }
}
