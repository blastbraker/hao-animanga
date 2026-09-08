package app.hao.bridge

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class MediaResponseHeadersTest {
    @Test
    fun `omits fixed lengths for compressible HLS playlists and subtitles`() {
        assertFalse(shouldForwardContentLength("application/vnd.apple.mpegurl"))
        assertFalse(shouldForwardContentLength("application/x-mpegURL; charset=utf-8"))
        assertFalse(shouldForwardContentLength("text/vtt; charset=utf-8"))
    }

    @Test
    fun `keeps fixed lengths for byte ranged video media`() {
        assertTrue(shouldForwardContentLength("video/mp4"))
        assertTrue(shouldForwardContentLength("video/mp2t"))
        assertTrue(shouldForwardContentLength("video/iso.segment"))
    }
}
