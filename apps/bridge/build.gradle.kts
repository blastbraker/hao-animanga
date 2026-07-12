plugins {
    kotlin("jvm") version "2.1.20"
    kotlin("plugin.serialization") version "2.1.20"
    application
}

group = "app.hao.bridge"
version = "0.1.0"

repositories {
    google()
    mavenCentral()
}

dependencies {
    implementation("io.javalin:javalin:6.6.0")
    implementation("com.fasterxml.jackson.core:jackson-databind:2.19.0")
    implementation("com.fasterxml.jackson.module:jackson-module-kotlin:2.19.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.8.1")
    implementation("com.android.tools.build:apksig:9.2.1")
    implementation("net.dongliu:apk-parser:2.6.10")
    implementation("org.slf4j:slf4j-simple:2.0.17")
    testImplementation(kotlin("test"))
}

kotlin { jvmToolchain(21) }
application { mainClass.set("app.hao.bridge.MainKt") }

tasks.test { useJUnitPlatform() }
