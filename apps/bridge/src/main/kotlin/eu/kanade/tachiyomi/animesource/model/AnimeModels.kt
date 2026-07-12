/* Apache-2.0 API shape derived from aniyomiorg/extensions-lib v14. */
@file:Suppress("PropertyName")

package eu.kanade.tachiyomi.animesource.model

import android.net.Uri
import okhttp3.Headers

enum class AnimeUpdateStrategy { ALWAYS_UPDATE, ONLY_FETCH_ONCE }

interface SAnime {
    var url: String
    var title: String
    var artist: String?
    var author: String?
    var description: String?
    var genre: String?
    var status: Int
    var thumbnail_url: String?
    var update_strategy: AnimeUpdateStrategy
    var initialized: Boolean

    companion object {
        const val UNKNOWN = 0
        const val ONGOING = 1
        const val COMPLETED = 2
        const val LICENSED = 3
        const val PUBLISHING_FINISHED = 4
        const val CANCELLED = 5
        const val ON_HIATUS = 6
        @JvmStatic fun create(): SAnime = SAnimeImpl()
    }
}

class SAnimeImpl : SAnime {
    override var url = ""
    override var title = ""
    override var artist: String? = null
    override var author: String? = null
    override var description: String? = null
    override var genre: String? = null
    override var status = SAnime.UNKNOWN
    override var thumbnail_url: String? = null
    override var update_strategy = AnimeUpdateStrategy.ALWAYS_UPDATE
    override var initialized = false
}

interface SEpisode {
    var url: String
    var name: String
    var date_upload: Long
    var episode_number: Float
    var scanlator: String?

    companion object {
        @JvmStatic fun create(): SEpisode = SEpisodeImpl()
    }
}

class SEpisodeImpl : SEpisode {
    override var url = ""
    override var name = ""
    override var date_upload = 0L
    override var episode_number = -1f
    override var scanlator: String? = null
}

data class Track(val url: String, val lang: String)

data class Video(
    val url: String,
    val quality: String,
    var videoUrl: String?,
    val headers: Headers? = null,
    val subtitleTracks: List<Track> = emptyList(),
    val audioTracks: List<Track> = emptyList(),
) {
    constructor(url: String, quality: String, videoUrl: String?, uri: Uri? = null, headers: Headers? = null) :
        this(url, quality, videoUrl, headers)
}

data class AnimesPage(val animes: List<SAnime>, val hasNextPage: Boolean)

sealed class AnimeFilter<T>(val name: String, var state: T) {
    open class Header(name: String) : AnimeFilter<Any>(name, 0)
    open class Separator(name: String = "") : AnimeFilter<Any>(name, 0)
    abstract class Select<V>(name: String, val values: Array<V>, state: Int = 0) : AnimeFilter<Int>(name, state)
    abstract class Text(name: String, state: String = "") : AnimeFilter<String>(name, state)
    abstract class CheckBox(name: String, state: Boolean = false) : AnimeFilter<Boolean>(name, state)
    abstract class TriState(name: String, state: Int = STATE_IGNORE) : AnimeFilter<Int>(name, state) {
        fun isIgnored() = state == STATE_IGNORE
        fun isIncluded() = state == STATE_INCLUDE
        fun isExcluded() = state == STATE_EXCLUDE
        companion object {
            const val STATE_IGNORE = 0
            const val STATE_INCLUDE = 1
            const val STATE_EXCLUDE = 2
        }
    }
    abstract class Group<V>(name: String, state: List<V>) : AnimeFilter<List<V>>(name, state)
    abstract class Sort(name: String, val values: Array<String>, state: Selection? = null) : AnimeFilter<Sort.Selection?>(name, state) {
        data class Selection(val index: Int, val ascending: Boolean)
    }
}
data class AnimeFilterList(val list: List<AnimeFilter<*>>) : List<AnimeFilter<*>> by list {
    constructor(vararg filters: AnimeFilter<*>) : this(filters.asList())
}
