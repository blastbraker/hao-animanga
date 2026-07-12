package app.hao.bridge

import java.lang.reflect.Array as ReflectArray
import java.nio.file.Files
import java.nio.file.Path

/** Starts only the Android compatibility services required by extension sources. */
object AndroidCompatibilityBootstrap {
    @Volatile private var initialized = false

    @Synchronized
    fun initialize(dataRoot: Path) {
        if (initialized) return
        val androidRoot = dataRoot.resolve("android").toAbsolutePath().normalize()
        Files.createDirectories(androidRoot)

        // GlobalConfigManager reads this when its singleton is initialized.
        System.setProperty("suwayomi.tachidesk.config.server.rootDir", androidRoot.toString())

        val appClass = Class.forName("eu.kanade.tachiyomi.App")
        val application = appClass.getDeclaredConstructor().newInstance()
        val appModule = Class.forName("eu.kanade.tachiyomi.AppModuleKt")
            .getMethod("createAppModule", Class.forName("android.app.Application"))
            .invoke(null, application)
        val androidModule = Class.forName("xyz.nulldev.androidcompat.AndroidCompatModuleKt")
            .getMethod("androidCompatModule")
            .invoke(null)
        val configModule = Class.forName("xyz.nulldev.ts.config.ConfigManagerModuleKt")
            .getMethod("configManagerModule")
            .invoke(null)

        val moduleClass = Class.forName("org.koin.core.module.Module")
        val modules = ReflectArray.newInstance(moduleClass, 3)
        ReflectArray.set(modules, 0, appModule)
        ReflectArray.set(modules, 1, androidModule)
        ReflectArray.set(modules, 2, configModule)

        val koinApplicationClass = Class.forName("org.koin.core.KoinApplication")
        val companion = koinApplicationClass.getField("Companion").get(null)
        val koinApplication = companion.javaClass.getMethod("init").invoke(companion)
        koinApplicationClass.getMethod("modules", modules.javaClass).invoke(koinApplication, modules)
        Class.forName("org.koin.core.context.DefaultContextExtKt")
            .getMethod("startKoin", koinApplicationClass)
            .invoke(null, koinApplication)

        val initializer = Class.forName("xyz.nulldev.androidcompat.AndroidCompatInitializer").getDeclaredConstructor().newInstance()
        initializer.javaClass.getMethod("init").invoke(initializer)

        val compatibility = Class.forName("xyz.nulldev.androidcompat.AndroidCompat").getDeclaredConstructor().newInstance()
        compatibility.javaClass.getMethod("startApp", Class.forName("android.app.Application")).invoke(compatibility, application)
        initialized = true
    }
}
