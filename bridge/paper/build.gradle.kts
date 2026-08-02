plugins {
    java
}

// ---------------------------------------------------------------------------
// Uyumluluk profili tek gerçek kaynaktır: sürümler build script'ine gömülmez.
// compatibility/README.md kural 1.
// ---------------------------------------------------------------------------
val profileFile = rootProject.file("../../compatibility/paper-26.2-build-84-v1.yaml")

/**
 * "paper.api_coordinate" gibi iki seviyeli düz bir alanı okur.
 *
 * Bilinçli olarak minimal: build script'ine YAML ayrıştırıcı bağımlılığı
 * eklemek supply-chain yüzeyini genişletirdi ve profilde okuduğumuz üç alan da
 * iki seviyeli düz skalerler.
 */
fun profileValue(section: String, key: String): String {
    require(profileFile.exists()) { "Uyumluluk profili bulunamadı: ${profileFile.absolutePath}" }

    var inSection = false
    for (raw in profileFile.readLines()) {
        val line = raw.substringBefore('#').trimEnd()
        if (line.isBlank()) continue

        val isTopLevel = !line.startsWith(" ") && !line.startsWith("\t")
        val trimmed = line.trim()

        if (isTopLevel) {
            inSection = trimmed == "$section:"
            continue
        }
        if (!inSection) continue

        if (trimmed.startsWith("$key:")) {
            val value = trimmed.substringAfter("$key:").trim().trim('"')
            require(value.isNotEmpty() && value != "null") {
                "Profil alanı doldurulmamış: $section.$key"
            }
            return value
        }
    }
    throw GradleException("Profil alanı bulunamadı: $section.$key")
}

val paperApiCoordinate = profileValue("paper", "api_coordinate")
val paperApiVersion = profileValue("paper", "api_version")
val javaMajor = profileValue("java", "toolchain_major").toInt()

group = "io.github.mcpdev"
version = "0.1.0-prototype.0"

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(javaMajor))
    }
}

// Supply chain: lock dosyaları release profilinde zorunludur ve dynamic
// version yasaktır (docs/security/supply-chain.md).
//   Yenileme: ./gradlew dependencies --write-locks
dependencyLocking {
    lockAllConfigurations()
}

dependencies {
    compileOnly(paperApiCoordinate)

    testImplementation(platform("org.junit:junit-bom:5.11.4"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.withType<JavaCompile>().configureEach {
    options.encoding = "UTF-8"
    options.compilerArgs.addAll(listOf("-Xlint:all", "-Werror"))
}

tasks.test {
    useJUnitPlatform()
}

// Deterministik JAR — reproducible build hedefi
tasks.withType<AbstractArchiveTask>().configureEach {
    isPreserveFileTimestamps = false
    isReproducibleFileOrder = true
}

tasks.processResources {
    val tokens = mapOf(
        "version" to project.version.toString(),
        "apiVersion" to paperApiVersion,
    )
    inputs.properties(tokens)
    filesMatching("plugin.yml") {
        expand(tokens)
    }
}

// Generated kaynaklar `pnpm run gen` tarafından üretilir ve commit edilir.
// Eksiklerse build erken ve anlaşılır biçimde başarısız olsun.
val checkGeneratedSources = tasks.register("checkGeneratedSources") {
    group = "verification"
    description = "pnpm run gen çıktılarının mevcut olduğunu doğrular"
    doLast {
        val generatedDir = file("src/main/java/io/github/mcpdev/bridge/generated")
        val required = listOf("BridgeOperation.java", "ErrorCode.java")
        val missing = required.filterNot { generatedDir.resolve(it).exists() }
        if (missing.isNotEmpty()) {
            throw GradleException(
                "Generated kaynaklar eksik: ${missing.joinToString()}. " +
                    "Repository kökünde `pnpm run gen` çalıştırın."
            )
        }
    }
}

tasks.compileJava {
    dependsOn(checkGeneratedSources)
}
