pluginManagement {
    repositories {
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
        maven { url = uri("https://jitpack.io") }
    }
}

rootProject.name = "backspace-android"

include(":app")
include(":core:model")
include(":core:network")
include(":core:voice")
include(":core:designsystem")
include(":core:updater")
include(":feature:auth")
include(":feature:spaces")
include(":feature:voice")
include(":feature:chat")
include(":feature:soundboard")
include(":feature:settings")
include(":feature:dm")
