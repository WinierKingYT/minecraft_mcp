rootProject.name = "paper-bridge"

// Supply-chain: repository tanımı tek yerde ve allowlist'e bağlıdır
// (docs/security/supply-chain.md).
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        mavenCentral()
        maven("https://repo.papermc.io/repository/maven-public/") {
            name = "papermc"
        }
    }
}
