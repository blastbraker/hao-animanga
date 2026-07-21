package app.hao.bridge

import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals

class SubtitleConverterTest {
    @Test
    fun `keeps WebVTT and converts SRT timestamps`() {
        assertEquals("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello\n", SubtitleConverter.toWebVtt("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello"))
        val converted = SubtitleConverter.toWebVtt("1\r\n00:00:01,250 --> 00:00:03,500\r\nHello\r\n")
        assertContains(converted, "00:00:01.250 --> 00:00:03.500")
        assertContains(converted, "Hello")
    }

    @Test
    fun `converts ASS dialogue and removes style overrides`() {
        val converted = SubtitleConverter.toWebVtt("[Events]\nDialogue: 0,0:00:01.20,0:00:04.50,Default,,0,0,0,,{\\i1}Hello\\Nworld")
        assertContains(converted, "00:00:01.200 --> 00:00:04.500")
        assertContains(converted, "Hello\nworld")
    }
}
