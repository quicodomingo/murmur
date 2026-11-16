plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "com.quicodomingo.murmur"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.quicodomingo.murmur"
        minSdk = 28
        targetSdk = 37
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        // Murmur needs a 64-bit phone: on 32-bit Android (the Galaxy A13, Cortex-A55) the live model
        // runs at half real time at best and loses audio (docs/MOBIL.md). Release ships arm64 only,
        // so Google Play doesn't offer it there; debug keeps 32-bit ARM to try screens on such a phone.
        debug {
            ndk { abiFilters += listOf("arm64-v8a", "armeabi-v7a") }
        }
        release {
            isMinifyEnabled = false
            ndk { abiFilters += listOf("arm64-v8a") }
        }
    }
    buildFeatures { compose = true; buildConfig = true }
    packaging { jniLibs { useLegacyPackaging = false } }
}

// The engine (Rust) and its bindings before every build.
val buildRust by tasks.registering(Exec::class) {
    workingDir = rootDir
    commandLine("./build-rust.sh")
}
tasks.named("preBuild") { dependsOn(buildRust) }

dependencies {
    val compose = platform("androidx.compose:compose-bom:2026.09.00")
    implementation(compose)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.activity:activity-compose:1.13.0")
    // UniFFI's Kotlin bindings call the engine through JNA.
    implementation("net.java.dev.jna:jna:5.19.1@aar")
    debugImplementation("androidx.compose.ui:ui-tooling")
}
