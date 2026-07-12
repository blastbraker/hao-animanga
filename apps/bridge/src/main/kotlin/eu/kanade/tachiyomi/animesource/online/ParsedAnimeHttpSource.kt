/* Apache-2.0 implementation adapted from Aniyomi v0.15.2.4. */
package eu.kanade.tachiyomi.animesource.online

import eu.kanade.tachiyomi.animesource.model.AnimesPage
import eu.kanade.tachiyomi.animesource.model.SAnime
import eu.kanade.tachiyomi.animesource.model.SEpisode
import eu.kanade.tachiyomi.animesource.model.Video
import eu.kanade.tachiyomi.util.asJsoup
import okhttp3.Response
import org.jsoup.nodes.Document
import org.jsoup.nodes.Element

abstract class ParsedAnimeHttpSource : AnimeHttpSource() {
    override fun popularAnimeParse(response: Response): AnimesPage {
        val document = response.asJsoup()
        return AnimesPage(document.select(popularAnimeSelector()).map(::popularAnimeFromElement), popularAnimeNextPageSelector()?.let { document.selectFirst(it) } != null)
    }
    protected abstract fun popularAnimeSelector(): String
    protected abstract fun popularAnimeFromElement(element: Element): SAnime
    protected abstract fun popularAnimeNextPageSelector(): String?

    override fun searchAnimeParse(response: Response): AnimesPage {
        val document = response.asJsoup()
        return AnimesPage(document.select(searchAnimeSelector()).map(::searchAnimeFromElement), searchAnimeNextPageSelector()?.let { document.selectFirst(it) } != null)
    }
    protected abstract fun searchAnimeSelector(): String
    protected abstract fun searchAnimeFromElement(element: Element): SAnime
    protected abstract fun searchAnimeNextPageSelector(): String?

    override fun latestUpdatesParse(response: Response): AnimesPage {
        val document = response.asJsoup()
        return AnimesPage(document.select(latestUpdatesSelector()).map(::latestUpdatesFromElement), latestUpdatesNextPageSelector()?.let { document.selectFirst(it) } != null)
    }
    protected abstract fun latestUpdatesSelector(): String
    protected abstract fun latestUpdatesFromElement(element: Element): SAnime
    protected abstract fun latestUpdatesNextPageSelector(): String?

    override fun animeDetailsParse(response: Response): SAnime = animeDetailsParse(response.asJsoup())
    protected abstract fun animeDetailsParse(document: Document): SAnime
    override fun episodeListParse(response: Response): List<SEpisode> = response.asJsoup().select(episodeListSelector()).map(::episodeFromElement)
    protected abstract fun episodeListSelector(): String
    protected abstract fun episodeFromElement(element: Element): SEpisode
    override fun videoListParse(response: Response): List<Video> = response.asJsoup().select(videoListSelector()).map(::videoFromElement)
    protected abstract fun videoListSelector(): String
    protected abstract fun videoFromElement(element: Element): Video
    override fun videoUrlParse(response: Response): String = videoUrlParse(response.asJsoup())
    protected abstract fun videoUrlParse(document: Document): String
}
