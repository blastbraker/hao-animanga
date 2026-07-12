/* Apache-2.0 API shape derived from Aniyomi v0.15.2.4. */
package eu.kanade.tachiyomi.animesource

import android.content.SharedPreferences
import androidx.preference.PreferenceScreen

interface ConfigurableAnimeSource : AnimeSource {
    fun getSourcePreferences(): SharedPreferences = throw IllegalStateException("Source preferences are not initialized")
    fun setupPreferenceScreen(screen: PreferenceScreen)
}

fun ConfigurableAnimeSource.preferenceKey(): String = "source_$id"
