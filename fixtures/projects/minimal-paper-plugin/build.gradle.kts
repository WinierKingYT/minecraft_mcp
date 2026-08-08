plugins {
    java
}

// Uyumluluk profili politikası: dependency_locking required + verification
// strict. Lock state `gradle.lockfile`, doğrulama kaydı
// `gradle/verification-metadata.xml` olarak commit'lenmiştir.
dependencyLocking {
    lockAllConfigurations()
}

group = "com.example"
version = "1.0.0"

// plugin.yml placeholder'ları: ${version} ve ${apiVersion} build sırasında
// bu değerlerle değiştirilir. apiVersion tanımsız kalırsa placeholder
// literal olarak JAR'a girer ve Paper plugin'i manifest yüzünden reddeder.
val apiVersion = "1.21"

java {
    // Uyumluluk profilindeki `java.toolchain_major` (25) ile sabitlenir;
    // bridge/paper ile aynı kural (profil değeri kullanılır, sabit değil).
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(25))
    }
}

repositories {
    mavenCentral()
    maven("https://repo.papermc.io/repository/maven-public/")
}

dependencies {
    compileOnly("io.papermc.paper:paper-api:26.2.build.84-stable")
}

tasks.withType<JavaCompile>().configureEach {
    options.encoding = "UTF-8"
}

tasks.withType<AbstractArchiveTask>().configureEach {
    isPreserveFileTimestamps = false
    isReproducibleFileOrder = true
}

// plugin.yml placeholder'larını build sırasında değiştirir (bridge/paper ile
// aynı kural); api-version placeholder'ı literal kalırsa Paper manifest'i
// reddeder ve plugin yüklenmez.
tasks.processResources {
    val tokens = mapOf(
        "version" to project.version.toString(),
        "apiVersion" to apiVersion,
    )
    inputs.properties(tokens)
    filesMatching("plugin.yml") {
        expand(tokens)
    }
}
