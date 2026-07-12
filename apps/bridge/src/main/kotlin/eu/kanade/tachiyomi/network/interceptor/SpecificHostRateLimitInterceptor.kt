package eu.kanade.tachiyomi.network.interceptor

import okhttp3.HttpUrl
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit

fun OkHttpClient.Builder.rateLimitHost(url: HttpUrl, permits: Int, period: Long, unit: TimeUnit): OkHttpClient.Builder = this
fun OkHttpClient.Builder.rateLimitHost(url: String, permits: Int, period: Long, unit: TimeUnit): OkHttpClient.Builder = this
