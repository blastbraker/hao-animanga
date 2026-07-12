/*
 * Binary-compatible HAO runtime implementation of Aniyomi extensions-lib v14.
 * API shape derived from the Apache-2.0 licensed aniyomiorg/extensions-lib project.
 */
package eu.kanade.tachiyomi.animesource

import eu.kanade.tachiyomi.animesource.model.SAnime
import eu.kanade.tachiyomi.animesource.model.SEpisode
import eu.kanade.tachiyomi.animesource.model.Video
import rx.Observable

interface AnimeSource {
    val id: Long
    val name: String
    suspend fun getAnimeDetails(anime: SAnime): SAnime
    suspend fun getEpisodeList(anime: SAnime): List<SEpisode>
    suspend fun getVideoList(episode: SEpisode): List<Video>
    fun fetchAnimeDetails(anime: SAnime): Observable<SAnime>
    fun fetchEpisodeList(anime: SAnime): Observable<List<SEpisode>>
    fun fetchVideoList(episode: SEpisode): Observable<List<Video>>
}

interface AnimeSourceFactory {
    fun createSources(): List<AnimeSource>
}
