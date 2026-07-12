/* Apache-2.0 API shape derived from aniyomiorg/extensions-lib v14. */
package eu.kanade.tachiyomi.animesource

import eu.kanade.tachiyomi.animesource.model.AnimeFilterList
import eu.kanade.tachiyomi.animesource.model.AnimesPage
import rx.Observable

interface AnimeCatalogueSource : AnimeSource {
    val lang: String
    val supportsLatest: Boolean
    suspend fun getPopularAnime(page: Int): AnimesPage
    suspend fun getSearchAnime(page: Int, query: String, filters: AnimeFilterList): AnimesPage
    suspend fun getLatestUpdates(page: Int): AnimesPage
    fun getFilterList(): AnimeFilterList
    fun fetchPopularAnime(page: Int): Observable<AnimesPage>
    fun fetchSearchAnime(page: Int, query: String, filters: AnimeFilterList): Observable<AnimesPage>
    fun fetchLatestUpdates(page: Int): Observable<AnimesPage>
}
