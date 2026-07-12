plugins {
    id("com.android.application")
    kotlin("android")
}

android {
    namespace = "app.hao.fixture.anime"
    compileSdk = 34

    defaultConfig {
        applicationId = "app.hao.fixture.anime"
        minSdk = 21
        targetSdk = 34
        versionCode = 1
        versionName = "14.1"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    kotlinOptions { jvmTarget = "1.8" }
}

dependencies {
    compileOnly("com.github.aniyomiorg:extensions-lib:14")
    compileOnly("io.reactivex:rxjava:1.3.8")
    compileOnly("com.squareup.okhttp3:okhttp:5.0.0-alpha.11")
}
