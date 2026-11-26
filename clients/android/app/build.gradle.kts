plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
}

val releaseKeystorePath: String? = System.getenv("KEYSTORE_FILE")
val hasReleaseSigning: Boolean = !releaseKeystorePath.isNullOrBlank() && file(releaseKeystorePath).exists()

android {
    namespace = "com.backspace.android"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.backspace.android"
        minSdk = 26
        targetSdk = 35
        versionCode = (findProperty("versionCode") as? String)?.toIntOrNull() ?: 20
        versionName = (findProperty("versionName") as? String)?.takeIf { it.isNotBlank() } ?: "0.16.0-alpha"
    }

    signingConfigs {
        if (hasReleaseSigning) {
            create("release") {
                storeFile = file(releaseKeystorePath!!)
                storePassword = System.getenv("KEYSTORE_PASSWORD")
                keyAlias = System.getenv("KEY_ALIAS")
                keyPassword = System.getenv("KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
            if (hasReleaseSigning) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_21
        targetCompatibility = JavaVersion.VERSION_21
    }

    kotlinOptions {
        jvmTarget = "21"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }
}

dependencies {
    implementation(project(":core:model"))
    implementation(project(":core:network"))
    implementation(project(":core:voice"))
    implementation(project(":core:designsystem"))
    implementation(project(":core:updater"))
    implementation(project(":feature:auth"))
    implementation(project(":feature:spaces"))
    implementation(project(":feature:voice"))
    implementation(project(":feature:chat"))
    implementation(project(":feature:soundboard"))
    implementation(project(":feature:settings"))
    implementation(project(":feature:dm"))

    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.navigation.compose)
}
