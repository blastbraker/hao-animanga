package app.hao.fixture.anime

import eu.kanade.tachiyomi.animesource.AnimeCatalogueSource
import eu.kanade.tachiyomi.animesource.model.AnimeFilterList
import eu.kanade.tachiyomi.animesource.model.AnimesPage
import eu.kanade.tachiyomi.animesource.model.SAnime
import eu.kanade.tachiyomi.animesource.model.SEpisode
import eu.kanade.tachiyomi.animesource.model.Video
import rx.Observable

class HaoFixtureSource : AnimeCatalogueSource {
    override val id = 0x48414f4649585455L
    override val name = "HAO Signed Fixture"
    override val lang = "en"
    override val supportsLatest = true

    private fun anime() = SAnime.create().apply {
        url = "/hao-fixture"
        title = "HAO Aniyomi APK Fixture"
        description = "A deterministic signed extension used only to test HAO's Aniyomi v14 adapter."
        genre = "Fixture, Openly Licensed"
        status = SAnime.COMPLETED
        initialized = true
    }

    private fun episode() = SEpisode.create().apply {
        url = "/hao-fixture/episode-1"
        name = "Episode 1 · Compatibility Contract"
        episode_number = 1f
        date_upload = 0L
    }

    override suspend fun getPopularAnime(page: Int) = AnimesPage(if (page == 1) listOf(anime()) else emptyList(), false)
    override suspend fun getSearchAnime(page: Int, query: String, filters: AnimeFilterList) =
        AnimesPage(if (page == 1 && anime().title.contains(query, ignoreCase = true)) listOf(anime()) else emptyList(), false)
    override suspend fun getLatestUpdates(page: Int) = getPopularAnime(page)
    override fun getFilterList() = AnimeFilterList()
    override fun fetchPopularAnime(page: Int) = Observable.just(AnimesPage(if (page == 1) listOf(anime()) else emptyList(), false))
    override fun fetchSearchAnime(page: Int, query: String, filters: AnimeFilterList) =
        Observable.just(AnimesPage(if (page == 1 && anime().title.contains(query, ignoreCase = true)) listOf(anime()) else emptyList(), false))
    override fun fetchLatestUpdates(page: Int) = fetchPopularAnime(page)

    override suspend fun getAnimeDetails(anime: SAnime) = anime()
    override suspend fun getEpisodeList(anime: SAnime) = listOf(episode())
    override suspend fun getVideoList(episode: SEpisode) = listOf(video())
    override fun fetchAnimeDetails(anime: SAnime) = Observable.just(this.anime())
    override fun fetchEpisodeList(anime: SAnime) = Observable.just(listOf(episode()))
    override fun fetchVideoList(episode: SEpisode) = Observable.just(listOf(video()))

    private fun video() = Video(
        "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
        "HD · CC0",
        "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
    )
}
