plugins {
    id("com.android.application")
}

android {
    namespace = "com.idibre.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.idibre.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // Signs release builds with the debug key so they install directly; use your own key for the Play Store.
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
