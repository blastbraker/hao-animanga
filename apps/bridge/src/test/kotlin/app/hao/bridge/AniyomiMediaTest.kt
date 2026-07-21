package app.hao.bridge

import kotlin.test.Test
import kotlin.test.assertEquals
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
}
