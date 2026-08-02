import { readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';

export interface CowFixtureOptions {
  readonly baseDir: string;
  readonly fixtureDir?: string;
  readonly autoCleanup?: boolean;
  readonly maxFixtures?: number;
}

export interface CowFixture {
  readonly fixtureId: string;
  readonly baseDir: string;
  readonly cowDir: string;
  readonly isModified: boolean;
  readonly createdAt: number;
  readonly modifiedFiles: Set<string>;
}

export class CowFixtureManager {
  #options: CowFixtureOptions;
  #fixtures = new Map<string, CowFixture>();
  #nextId = 1;

  constructor(options: CowFixtureOptions) {
    this.#options = {
      fixtureDir: join(options.baseDir, '.cow-fixtures'),
      autoCleanup: true,
      maxFixtures: 100,
      ...options,
    };
  }

  async createFixture(name?: string): Promise<CowFixture> {
    if (this.#fixtures.size >= (this.#options.maxFixtures ?? 100)) {
      throw new Error(`Max fixtures reached: ${this.#options.maxFixtures}`);
    }

    const fixtureId = name ?? `fixture_${this.#nextId++}`;
    const cowDir = join(this.#options.fixtureDir!, fixtureId);

    await mkdir(cowDir, { recursive: true });

    const fixture: CowFixture = {
      fixtureId,
      baseDir: this.#options.baseDir,
      cowDir,
      isModified: false,
      createdAt: Date.now(),
      modifiedFiles: new Set(),
    };

    this.#fixtures.set(fixtureId, fixture);
    return fixture;
  }

  async copyFile(fixtureId: string, relativePath: string): Promise<string> {
    const fixture = this.#fixtures.get(fixtureId);
    if (!fixture) {
      throw new Error(`Fixture not found: ${fixtureId}`);
    }

    const sourcePath = join(fixture.baseDir, relativePath);
    const targetPath = join(fixture.cowDir, relativePath);

    if (!existsSync(sourcePath)) {
      throw new Error(`Source file not found: ${sourcePath}`);
    }

    await mkdir(dirname(targetPath), { recursive: true });
    await cp(sourcePath, targetPath, { recursive: true });

    return targetPath;
  }

  async copyDirectory(fixtureId: string, relativePath: string = '.'): Promise<string> {
    const fixture = this.#fixtures.get(fixtureId);
    if (!fixture) {
      throw new Error(`Fixture not found: ${fixtureId}`);
    }

    const sourcePath = join(fixture.baseDir, relativePath);
    const targetPath = join(fixture.cowDir, relativePath);

    if (!existsSync(sourcePath)) {
      throw new Error(`Source directory not found: ${sourcePath}`);
    }

    await cp(sourcePath, targetPath, { recursive: true });

    return targetPath;
  }

  async readFile(fixtureId: string, relativePath: string): Promise<string> {
    const fixture = this.#fixtures.get(fixtureId);
    if (!fixture) {
      throw new Error(`Fixture not found: ${fixtureId}`);
    }

    const cowPath = join(fixture.cowDir, relativePath);
    const basePath = join(fixture.baseDir, relativePath);

    if (existsSync(cowPath)) {
      return readFile(cowPath, 'utf8');
    }

    if (existsSync(basePath)) {
      return readFile(basePath, 'utf8');
    }

    throw new Error(`File not found: ${relativePath}`);
  }

  async writeFile(fixtureId: string, relativePath: string, content: string): Promise<void> {
    const fixture = this.#fixtures.get(fixtureId);
    if (!fixture) {
      throw new Error(`Fixture not found: ${fixtureId}`);
    }

    const targetPath = join(fixture.cowDir, relativePath);
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, content, 'utf8');

    (fixture as { isModified: boolean }).isModified = true;
    fixture.modifiedFiles.add(relativePath);
  }

  async deleteFile(fixtureId: string, relativePath: string): Promise<void> {
    const fixture = this.#fixtures.get(fixtureId);
    if (!fixture) {
      throw new Error(`Fixture not found: ${fixtureId}`);
    }

    const cowPath = join(fixture.cowDir, relativePath);
    if (existsSync(cowPath)) {
      await rm(cowPath, { force: true });
    }

    (fixture as { isModified: boolean }).isModified = true;
    fixture.modifiedFiles.add(relativePath);
  }

  async commit(fixtureId: string): Promise<void> {
    const fixture = this.#fixtures.get(fixtureId);
    if (!fixture) {
      throw new Error(`Fixture not found: ${fixtureId}`);
    }

    // Copy modified files back to base
    for (const relativePath of fixture.modifiedFiles) {
      const cowPath = join(fixture.cowDir, relativePath);
      const basePath = join(fixture.baseDir, relativePath);

      if (existsSync(cowPath)) {
        await mkdir(dirname(basePath), { recursive: true });
        await cp(cowPath, basePath, { recursive: true });
      }
    }

    // Cleanup
    await rm(fixture.cowDir, { recursive: true, force: true });
    this.#fixtures.delete(fixtureId);
  }

  async rollback(fixtureId: string): Promise<void> {
    const fixture = this.#fixtures.get(fixtureId);
    if (!fixture) {
      throw new Error(`Fixture not found: ${fixtureId}`);
    }

    await rm(fixture.cowDir, { recursive: true, force: true });
    this.#fixtures.delete(fixtureId);
  }

  getFixture(fixtureId: string): CowFixture | undefined {
    return this.#fixtures.get(fixtureId);
  }

  listFixtures(): CowFixture[] {
    return Array.from(this.#fixtures.values());
  }

  async cleanup(): Promise<void> {
    for (const [id, fixture] of this.#fixtures) {
      try {
        await rm(fixture.cowDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
      this.#fixtures.delete(id);
    }
  }

  destroy(): void {
    this.#fixtures.clear();
  }
}
