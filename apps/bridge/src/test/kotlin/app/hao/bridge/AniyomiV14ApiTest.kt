package app.hao.bridge

import eu.kanade.tachiyomi.animesource.AnimeCatalogueSource
import eu.kanade.tachiyomi.animesource.model.AnimeFilterList
import eu.kanade.tachiyomi.animesource.model.AnimesPage
import eu.kanade.tachiyomi.animesource.model.SAnime
import eu.kanade.tachiyomi.animesource.model.SEpisode
import eu.kanade.tachiyomi.animesource.model.Video
import rx.Observable
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class AniyomiV14ApiTest {
    @Test
    fun `v14 source model factories and rx contract execute without Android`() {
        val source = TestSource()
        val page = source.fetchPopularAnime(1).toBlocking().single()
        assertEquals("HAO API Fixture", page.animes.single().title)
        val episode = source.fetchEpisodeList(page.animes.single()).toBlocking().single().single()
        assertEquals(1f, episode.episode_number)
        val video = source.fetchVideoList(episode).toBlocking().single().single()
        assertTrue(video.videoUrl!!.startsWith("https://"))
    }

    private class TestSource : AnimeCatalogueSource {
        override val id = 1L
        override val name = "test"
        override val lang = "en"
        override val supportsLatest = true
        private fun anime() = SAnime.create().apply { url = "/fixture"; title = "HAO API Fixture" }
        private fun episode() = SEpisode.create().apply { url = "/fixture/1"; name = "Episode 1"; episode_number = 1f }
        private fun video() = Video("https://example.com/fixture.mp4", "HD", "https://example.com/fixture.mp4")
        override suspend fun getPopularAnime(page: Int) = AnimesPage(listOf(anime()), false)
        override suspend fun getSearchAnime(page: Int, query: String, filters: AnimeFilterList) = getPopularAnime(page)
        override suspend fun getLatestUpdates(page: Int) = getPopularAnime(page)
        override fun getFilterList() = AnimeFilterList()
        override fun fetchPopularAnime(page: Int) = Observable.just(AnimesPage(listOf(anime()), false))
        override fun fetchSearchAnime(page: Int, query: String, filters: AnimeFilterList) = fetchPopularAnime(page)
        override fun fetchLatestUpdates(page: Int) = fetchPopularAnime(page)
        override suspend fun getAnimeDetails(anime: SAnime) = anime
        override suspend fun getEpisodeList(anime: SAnime) = listOf(episode())
        override suspend fun getVideoList(episode: SEpisode) = listOf(video())
        override fun fetchAnimeDetails(anime: SAnime) = Observable.just(anime)
        override fun fetchEpisodeList(anime: SAnime) = Observable.just(listOf(episode()))
        override fun fetchVideoList(episode: SEpisode) = Observable.just(listOf(video()))
    }
}
