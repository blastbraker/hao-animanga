/* Apache-2.0 API-compatible subset derived from Aniyomi v0.15.2.4. */
package eu.kanade.tachiyomi.network

import app.hao.bridge.AnimeNetworkPolicy
import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.CacheControl
import okhttp3.Call
import okhttp3.Callback
import okhttp3.Headers
import okhttp3.HttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import rx.Observable
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

class NetworkHelper {
    val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .callTimeout(60, TimeUnit.SECONDS)
        .addInterceptor(AnimeNetworkPolicy)
        .build()
    @Deprecated("The regular client handles Cloudflare by default")
    val cloudflareClient: OkHttpClient = client
    fun defaultUserAgentProvider() = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) HAO-Bridge/0.1"
}

fun GET(url: String, headers: Headers = Headers.Builder().build(), cache: CacheControl? = null): Request =
    Request.Builder().url(url).headers(headers).get().apply { cache?.let(::cacheControl) }.build()

fun GET(url: HttpUrl, headers: Headers = Headers.Builder().build(), cache: CacheControl? = null): Request =
    Request.Builder().url(url).headers(headers).get().apply { cache?.let(::cacheControl) }.build()

fun Call.asObservableSuccess(): Observable<Response> = Observable.create { subscriber ->
    enqueue(object : Callback {
        override fun onFailure(call: Call, error: IOException) {
            if (!subscriber.isUnsubscribed) subscriber.onError(error)
        }
        override fun onResponse(call: Call, response: Response) {
            if (subscriber.isUnsubscribed) response.close()
            else if (!response.isSuccessful) {
                response.close()
                subscriber.onError(IOException("HTTP ${response.code}"))
            } else {
                subscriber.onNext(response)
                subscriber.onCompleted()
            }
        }
    })
}

suspend fun Call.awaitSuccess(): Response = suspendCancellableCoroutine { continuation ->
    continuation.invokeOnCancellation { cancel() }
    enqueue(object : Callback {
        override fun onFailure(call: Call, error: IOException) {
            if (continuation.isActive) continuation.resumeWithException(error)
        }
        override fun onResponse(call: Call, response: Response) {
            if (!continuation.isActive) response.close()
            else if (!response.isSuccessful) {
                response.close()
                continuation.resumeWithException(IOException("HTTP ${response.code}"))
            } else continuation.resume(response)
        }
    })
}
