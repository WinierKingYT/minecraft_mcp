plugins {
    java
}

group = "com.example"
version = "1.0.0"

// plugin.yml placeholder'ları: ${version} ve ${apiVersion} build sırasında
// değiştirilir; apiVersion tanımsız kalırsa Paper manifest yüzünden reddeder.
val apiVersion = "1.21"

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(21))
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
