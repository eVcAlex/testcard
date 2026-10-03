plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
}

// CI stamps the build number; Android refuses an update that is not a higher versionCode. Native builds start at 100000 so they
// are above every React Native build (those stay below it), which is what lets this app update the old one in place.
val buildNumber = (findProperty("buildNumber") as String?)?.toInt() ?: 1

android {
    namespace = "com.evcalex.testcard.tv"
    compileSdk = 36

    defaultConfig {
        // The old React Native app's id, so installing this over it is an update that keeps its data (adopted on first launch).
        applicationId = "com.evcalex.testcard"
        minSdk = 24
        targetSdk = 36
        versionCode = 100000 + buildNumber
        versionName = "0.2.$buildNumber"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        // The sync server; `-PsyncUrl=http://10.0.2.2:8787` points a build at a local `wrangler dev` from the emulator.
        // Which manifest entry the updater follows: `firetv`, the entry the old app followed.
        buildConfigField("String", "UPDATE_APK_KEY", "\"${findProperty("apkKey") ?: "firetv"}\"")
        buildConfigField("String", "SYNC_URL", "\"${findProperty("syncUrl") ?: "https://testcard-sync.evcalex.workers.dev"}\"")
    }

    // Own signing key when the keystore file is given (the workflow decodes ANDROID_KEYSTORE_BASE64 into it). Otherwise the Expo debug
    // key the old app is signed with (public, so no secret): Android only installs an update signed by the same key.
    val keystore = System.getenv("ANDROID_KEYSTORE_FILE")
    signingConfigs {
        create("oldApp") {
            storeFile = file("expo-debug.keystore")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
        if (keystore != null) {
            create("release") {
                storeFile = file(keystore)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
    }

    lint {
        // Media3 marks much of its player API unstable; the app pins its version and uses it from Kotlin, where lint cannot see an OptIn.
        disable += "UnsafeOptInUsageError"
    }

    buildTypes {
        // The emulator is x86_64; debug carries both so it installs on either.
        debug { ndk { abiFilters += listOf("x86_64", "armeabi-v7a") } }
        release {
            // Every Fire stick runs 32-bit ARM, and it keeps the APK small.
            ndk { abiFilters += listOf(findProperty("releaseAbi") as String? ?: "armeabi-v7a") }
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("oldApp")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlin { jvmToolchain(17) }

    buildFeatures {
        compose = true
        buildConfig = true
    }
}

dependencies {
    implementation(project(":core"))
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.foundation)
    implementation(libs.tv.material)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.coil.compose)
    implementation(libs.zxing.core)
    // Installs the baseline profile (src/main/baseline-prof.txt) at first run so the code the launch and the lists use is compiled ahead of time.
    implementation(libs.androidx.profileinstaller)
    implementation(libs.coil.network.okhttp)
    implementation(libs.media3.exoplayer)
    implementation(libs.media3.ui)
    implementation(libs.media3.datasource.okhttp)

    androidTestImplementation(platform(libs.compose.bom))
    androidTestImplementation(libs.compose.ui.test.junit4)
    androidTestImplementation(libs.androidx.test.runner)
    androidTestImplementation(libs.androidx.test.ext.junit)
    debugImplementation(libs.compose.ui.test.manifest)
}
