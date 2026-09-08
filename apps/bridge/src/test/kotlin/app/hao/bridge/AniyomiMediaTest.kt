package app.hao.bridge

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class AniyomiMediaTest {
    @Test
    fun `finds an MPEG transport stream after a PNG compatibility wrapper`() {
        val wrapper = byteArrayOf(0x89.toByte(), 0x50, 0x4e, 0x47) + ByteArray(248)
        val transportStream = transportStream()

        assertEquals(252, mpegTransportStreamOffset(wrapper + transportStream))
    }

    @Test
    fun `leaves ordinary PNG responses untouched`() {
        assertNull(mpegTransportStreamOffset(byteArrayOf(0x89.toByte(), 0x50, 0x4e, 0x47) + ByteArray(600)))
    }

    @Test
    fun `recognizes raw transport streams despite an unrelated content type`() {
        assertEquals(0, mpegTransportStreamOffset(transportStream()))
    }

    @Test
    fun `recognizes content types used to disguise transport segments`() {
        assertTrue(isDisguisedMediaContentType("image/jpeg"))
        assertTrue(isDisguisedMediaContentType("text/html; charset=utf-8"))
        assertTrue(isDisguisedMediaContentType("application/javascript"))
        assertFalse(isDisguisedMediaContentType("video/mp2t"))
        assertFalse(isDisguisedMediaContentType("application/octet-stream"))
    }

    @Test
    fun `maps browser probe ranges onto the unwrapped stream`() {
        assertEquals(0..2047, parseByteRange("bytes=0-2047", 10_000))
        assertEquals(2_048..9_999, parseByteRange("bytes=2048-", 10_000))
        assertEquals(9_488..9_999, parseByteRange("bytes=-512", 10_000))
    }

    @Test
    fun `caps oversized range ends at the stream boundary`() {
        assertEquals(9_500..9_999, parseByteRange("bytes=9500-12000", 10_000))
    }

    @Test
    fun `rejects unsatisfiable ranges`() {
        assertFailsWith<IllegalArgumentException> { parseByteRange("bytes=10000-", 10_000) }
        assertFailsWith<IllegalArgumentException> { parseByteRange("bytes=-", 10_000) }
    }

    @Test
    fun `builds a standards compliant ranged transport response`() {
        val response = rangedTransportStream(ByteArray(4_096) { (it % 251).toByte() }, "bytes=188-375")
        assertEquals(206, response.status)
        assertEquals("video/mp2t", response.contentType)
        assertEquals("188", response.contentLength)
        assertEquals("bytes 188-375/4096", response.contentRange)
        assertEquals(188, response.body.readBytes().size)
    }

    @Test
    fun `builds a native HLS master playlist for separate audio`() {
        val playlist = buildHlsMasterPlaylist(
            "/v1/anime/streams/video/media",
            listOf(
                HlsAudioRendition("Japanese", "ja", "/v1/anime/streams/audio-ja/media", true),
                HlsAudioRendition("English", "en", "/v1/anime/streams/audio-en/media", false),
            ),
        )

        assertTrue(playlist.startsWith("#EXTM3U\n"))
        assertTrue(playlist.contains("TYPE=AUDIO,GROUP-ID=\"hao-audio\",NAME=\"Japanese\",DEFAULT=YES"))
        assertTrue(playlist.contains("LANGUAGE=\"en\",URI=\"/v1/anime/streams/audio-en/media\""))
        assertTrue(playlist.contains("#EXT-X-STREAM-INF:BANDWIDTH=12000000,AUDIO=\"hao-audio\"\n/v1/anime/streams/video/media"))
    }

    @Test
    fun `recognizes HLS urls with query parameters`() {
        assertTrue(isHlsUrl("https://media.example.test/video/index.m3u8?token=short-lived"))
        assertFalse(isHlsUrl("https://media.example.test/video/file.mp4?token=short-lived"))
    }

    private fun transportStream() = ByteArray(188 * 5).also { bytes ->
        bytes[0] = 0x47
        bytes[188] = 0x47
        bytes[376] = 0x47
        bytes[564] = 0x47
        bytes[752] = 0x47
    }
}
