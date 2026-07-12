package eu.kanade.tachiyomi.util

import okhttp3.Response
import org.jsoup.Jsoup
import org.jsoup.nodes.Document

fun Response.asJsoup(html: String? = null): Document = use { response ->
    val body = html ?: response.body.string()
    Jsoup.parse(body, response.request.url.toString())
}
