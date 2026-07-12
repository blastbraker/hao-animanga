package app.hao.bridge

import eu.kanade.tachiyomi.animesource.model.SAnime
import eu.kanade.tachiyomi.animesource.model.SEpisode
import eu.kanade.tachiyomi.animesource.model.Video
import eu.kanade.tachiyomi.animesource.online.ParsedAnimeHttpSource
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.jsoup.nodes.Document
import org.jsoup.nodes.Element
import kotlin.test.Test
import kotlin.test.assertEquals

class AnimeHttpSourceRuntimeTest {
    @Test
    fun `parsed v14 source converts HTML into normalized anime models`() {
        val response = Response.Builder()
            .request(Request.Builder().url("https://fixture.invalid/popular").build())
            .protocol(Protocol.HTTP_1_1)
            .code(200)
            .message("OK")
            .body("<div class='anime'><a href='/one'>Fixture One</a></div>".toResponseBody())
            .build()
        val page = ParsedFixtureSource().parsePopular(response)
        assertEquals("Fixture One", page.animes.single().title)
        assertEquals("/one", page.animes.single().url)
    }

    private class ParsedFixtureSource : ParsedAnimeHttpSource() {
        override val baseUrl = "https://fixture.invalid"
        override val name = "Parsed fixture"
        override val lang = "en"
        override val supportsLatest = false
        fun parsePopular(response: Response) = popularAnimeParse(response)
        override fun popularAnimeRequest(page: Int) = Request.Builder().url("$baseUrl/popular").build()
        override fun popularAnimeSelector() = ".anime"
        override fun popularAnimeFromElement(element: Element) = SAnime.create().apply {
            title = element.text()
            url = element.selectFirst("a")!!.attr("href")
        }
        override fun popularAnimeNextPageSelector(): String? = null
        override fun searchAnimeRequest(page: Int, query: String, filters: eu.kanade.tachiyomi.animesource.model.AnimeFilterList) = popularAnimeRequest(page)
        override fun searchAnimeSelector() = popularAnimeSelector()
        override fun searchAnimeFromElement(element: Element) = popularAnimeFromElement(element)
        override fun searchAnimeNextPageSelector(): String? = null
        override fun latestUpdatesRequest(page: Int) = popularAnimeRequest(page)
        override fun latestUpdatesSelector() = popularAnimeSelector()
        override fun latestUpdatesFromElement(element: Element) = popularAnimeFromElement(element)
        override fun latestUpdatesNextPageSelector(): String? = null
        override fun animeDetailsParse(document: Document) = popularAnimeFromElement(document.selectFirst(".anime")!!)
        override fun episodeListSelector() = ".episode"
        override fun episodeFromElement(element: Element) = SEpisode.create()
        override fun episodeVideoParse(response: Response) = SEpisode.create()
        override fun videoListSelector() = ".video"
        override fun videoFromElement(element: Element) = Video("https://fixture.invalid/video.mp4", "HD", "https://fixture.invalid/video.mp4")
        override fun videoUrlParse(document: Document) = "https://fixture.invalid/video.mp4"
    }
}
