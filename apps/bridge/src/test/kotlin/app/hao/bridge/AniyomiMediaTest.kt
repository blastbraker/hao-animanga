package app.hao.bridge

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull

class AniyomiMediaTest {
    @Test
    fun `finds an MPEG transport stream after a PNG compatibility wrapper`() {
        val wrapper = byteArrayOf(0x89.toByte(), 0x50, 0x4e, 0x47) + ByteArray(248)
        val transportStream = ByteArray(188 * 3).also { bytes ->
            bytes[0] = 0x47
            bytes[188] = 0x47
            bytes[376] = 0x47
        }

        assertEquals(252, mpegTransportStreamOffset(wrapper + transportStream))
    }

    @Test
    fun `leaves ordinary PNG responses untouched`() {
        assertNull(mpegTransportStreamOffset(byteArrayOf(0x89.toByte(), 0x50, 0x4e, 0x47) + ByteArray(600)))
    }

    @Test
    fun `does not unwrap non-PNG transport streams`() {
        val transportStream = ByteArray(188 * 3).also { bytes ->
            bytes[0] = 0x47
            bytes[188] = 0x47
            bytes[376] = 0x47
        }

        assertNull(mpegTransportStreamOffset(transportStream))
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
}
