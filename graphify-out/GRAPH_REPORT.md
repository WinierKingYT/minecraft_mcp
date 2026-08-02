# Graph Report - C:\Users\faruk\Desktop\minecraftmcp  (2026-08-02)

## Corpus Check
- 252 files · ~96,004 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2172 nodes · 3115 edges · 143 communities (133 shown, 10 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 81 edges (avg confidence: 0.79)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Error Catalog Codes
- Bridge Boot Identity
- Bridge Auth and Endpoints
- Gradle Supply-Chain Validation
- Bridge Request Schema
- Compatibility Profile and Smoke
- JSON Schema Primitives
- Capability Risk Enums
- Bridge Response Schema
- Bridge HTTP Client
- Schema Field Descriptors
- Root Package Manifest
- Bridge Endpoint Tests
- Tool Error Schema
- Evidence Model
- Config Numeric Bounds
- IPC Contract Types
- TypeScript Build Config
- MCP Server Package
- Run Supervisor Package
- Build Plan and Modes
- Logging and Supervisor Client
- Scenario DSL Schema
- Supervisor Endpoint and Startup
- Ipc Server
- Project Registry
- Registry
- Backend
- Error Catalog File Schema
- Package
- Bridge Event Schema
- Package
- Types
- Service
- Index
- Facade
- Source Snapshot
- Jsonreader
- Querydispatchertest
- Capability Schema
- Index
- Error Schema
- Capabilities Generated
- Scenario Schema
- Validate Schemas
- Bridgeoperation
- Paperreadoperations
- Config Schema
- Config Schema
- Error Schema
- Error Schema
- Package
- Generate Contracts
- Build Executor
- Bridgeruntimecontexttest
- Capability Schema
- Config Schema
- Config Schema
- System
- Build Executor
- Bridge Event Schema
- Bridge Event Schema
- Error Schema
- Error Schema
- Artifact Selection
- Java Toolchain
- Querydispatcher
- Config Schema
- Config Schema
- Config Schema
- Config Schema
- Error Schema
- Error Schema
- Tsconfig
- Runtime Registry
- Tsconfig
- Capability Schema
- Capability Schema
- Capability Schema
- Capability Schema
- Config Schema
- Config Schema
- Config Schema
- Bridge Event Schema
- Scenario Schema
- Scenario Schema
- Tsconfig
- Check Docs
- Verify Compatibility
- Stdio Transport
- Querydispatchertest
- Package
- Capability Schema
- Config Schema
- Scenario Schema
- Error Schema
- Server
- Stdout Purity Test
- Bridgeoperationexception
- Readoperations
- Capability Schema
- Package
- Config Schema
- Config Schema
- Bridge Event Schema
- Scenario Schema
- Scenario Schema
- Ndjson
- Tsconfig
- Package
- Error Schema
- Error Schema
- Tsconfig
- Check Parse
- Papermainthreadexecutor
- Capability Schema
- Capability Schema
- Capability Schema
- Capability Schema
- Config Schema
- Scenario Schema
- Endpoint
- Bridge Event Schema
- Bridge Event Schema
- Tool Result Schema
- Scenario Schema
- Bridgetimeoutexception
- Config Schema
- Gradlew
- Capability Schema
- Capability Schema
- Capability Schema
- Config Schema
- Config Schema
- Capability Schema
- Capability Schema
- Capability Schema
- Bridge Event Schema
- Bridge Event Schema
- Tool Surface Test

## God Nodes (most connected - your core abstractions)
1. `ErrorCode` - 110 edges
2. `BridgeEndpointsTest` - 30 edges
3. `BridgeHttpServer` - 27 edges
4. `SupervisorService` - 25 edges
5. `compilerOptions` - 23 edges
6. `BridgeHttpServerTest` - 20 edges
7. `EventRingBuffer` - 16 edges
8. `RecordingOperations` - 16 edges
9. `PaperBridgePlugin` - 15 edges
10. `BridgeOperation` - 15 edges

## Surprising Connections (you probably didn't know these)
- `ServiceOptions` --references--> `ProjectRegistry`  [EXTRACTED]
  apps/run-supervisor/src/service.ts → apps/run-supervisor/src/project-registry.ts
- `ServerOptions` --references--> `ToolFacade`  [EXTRACTED]
  apps/mcp-server/src/server.ts → apps/mcp-server/src/tools/facade.ts
- `ServerRuntimeInfo` --references--> `SupervisorClient`  [EXTRACTED]
  apps/mcp-server/src/tools/system.ts → apps/mcp-server/src/supervisor-client.ts
- `StdioTransport` --implements--> `TransportAdapter`  [EXTRACTED]
  apps/mcp-server/src/transport/stdio-transport.ts → apps/mcp-server/src/transport/types.ts
- `BuildOutcome` --references--> `SelectedArtifact`  [EXTRACTED]
  apps/run-supervisor/src/build-executor.ts → apps/run-supervisor/src/artifact-selection.ts

## Import Cycles
- None detected.

## Communities (143 total, 10 thin omitted)

### Community 0 - "Error Catalog Codes"
Cohesion: 0.02
Nodes (110): ErrorCode, ACTOR_CRASHED, ACTOR_LOGIN_FAILED, ACTOR_UNAVAILABLE, ARCHIVE_ENTRY_OUTSIDE_ROOT, ARCHIVE_EXPANSION_LIMIT, ARTIFACT_AMBIGUOUS, ARTIFACT_NOT_FOUND (+102 more)

### Community 1 - "Bridge Boot Identity"
Cohesion: 0.06
Nodes (23): BridgeBoot, BridgeEvent, EventCursorException, Kind, EXPIRED, INSTANCE_MISMATCH, EventFactory, EventRingBuffer (+15 more)

### Community 2 - "Bridge Auth and Endpoints"
Cohesion: 0.06
Nodes (29): BridgeCredentials, BridgeEndpoints, EventsHandler, FunctionalInterface, QueryHandler, BridgeHttpServer, Override, Route (+21 more)

### Community 3 - "Gradle Supply-Chain Validation"
Cohesion: 0.06
Nodes (45): buildScripts(), DYNAMIC_VERSION_PATTERNS, extractGradleVersion(), FindingSeverity, GradleValidationResult, hostOf(), parseProperties(), sha256File() (+37 more)

### Community 4 - "Bridge Request Schema"
Cohesion: 0.04
Nodes (47): additionalProperties, type, pattern, type, type, pattern, type, $id (+39 more)

### Community 5 - "Compatibility Profile and Smoke"
Cohesion: 0.08
Nodes (33): assertProfileUsable(), CompatibilityProfile, loadCompatibilityProfile(), ProfileError, expectMutationRejected(), expectUnauthorized(), runM0Smoke(), SmokeEvidence (+25 more)

### Community 6 - "JSON Schema Primitives"
Cohesion: 0.05
Nodes (40): additionalProperties, properties, required, type, items, minItems, type, uniqueItems (+32 more)

### Community 7 - "Capability Risk Enums"
Cohesion: 0.05
Nodes (39): enum, enum, enum, build, none, profile, project, description (+31 more)

### Community 8 - "Bridge Response Schema"
Cohesion: 0.05
Nodes (37): additionalProperties, allOf, pattern, type, type, $ref, $id, type (+29 more)

### Community 9 - "Bridge HTTP Client"
Cohesion: 0.09
Nodes (21): BridgeClient, BridgeClientError, Handshake, readHandshake(), RuntimeImage, CleanupResult, delay(), finish() (+13 more)

### Community 10 - "Schema Field Descriptors"
Cohesion: 0.07
Nodes (36): description, pattern, type, pattern, type, properties, pattern, type (+28 more)

### Community 11 - "Root Package Manifest"
Cohesion: 0.06
Nodes (32): ajv, ajv-formats, description, devDependencies, ajv, ajv-formats, @types/node, typescript (+24 more)

### Community 12 - "Bridge Endpoint Tests"
Cohesion: 0.16
Nodes (7): BridgeEndpointsTest, AfterEach, Builder, HttpClient, HttpRequest, HttpResponse, Test

### Community 13 - "Tool Error Schema"
Cohesion: 0.06
Nodes (31): additionalProperties, description, pattern, type, description, type, $id, CANCELLED (+23 more)

### Community 14 - "Evidence Model"
Cohesion: 0.12
Nodes (18): assertProvenanceComplete(), CleanupResult, EvidenceKind, EvidenceManifest, EvidenceProducer, RedactionProfile, ReportManifest, ScenarioResult (+10 more)

### Community 15 - "Config Numeric Bounds"
Cohesion: 0.07
Nodes (29): const, description, maximum, minimum, type, maximum, minimum, type (+21 more)

### Community 16 - "IPC Contract Types"
Cohesion: 0.08
Nodes (26): BridgeEventsParams, BridgeQueryParams, BuildRunParams, BuildRunResult, CleanupEvidence, EvidenceGetParams, EvidenceGetResult, IpcError (+18 more)

### Community 17 - "TypeScript Build Config"
Cohesion: 0.07
Nodes (26): ES2023, node, compilerOptions, composite, declaration, declarationMap, exactOptionalPropertyTypes, forceConsistentCasingInFileNames (+18 more)

### Community 18 - "MCP Server Package"
Cohesion: 0.08
Nodes (23): bin, minecraft-plugin-dev-mcp, dependencies, @mcpdev/contracts, @mcpdev/generated-types, yaml, devDependencies, @types/node (+15 more)

### Community 19 - "Run Supervisor Package"
Cohesion: 0.08
Nodes (23): bin, mcpdev-supervisor, dependencies, @mcpdev/contracts, @mcpdev/evidence-model, yaml, devDependencies, @types/node (+15 more)

### Community 20 - "Build Plan and Modes"
Cohesion: 0.14
Nodes (18): BASE_ARGS, BuildPlan, BuildPlanError, BuildPlanOptions, createBuildPlan(), MODE_TASKS, supportedModes(), assertEnvironmentClean() (+10 more)

### Community 21 - "Logging and Supervisor Client"
Cohesion: 0.13
Nodes (10): LEVEL_ORDER, log(), LogLevel, redact(), Pending, SupervisorCallError, SupervisorClient, SupervisorClientOptions (+2 more)

### Community 22 - "Scenario DSL Schema"
Cohesion: 0.09
Nodes (22): $ref, $ref, pattern, type, enum, properties, cleanup, given (+14 more)

### Community 23 - "Supervisor Endpoint and Startup"
Cohesion: 0.20
Nodes (17): makeEndpointPath(), newToken(), removeControlFile(), writeControlFile(), log(), main(), runStartupRecovery(), ADR-0003 (+9 more)

### Community 24 - "Ipc Server"
Cohesion: 0.17
Nodes (9): IpcServerOptions, KNOWN_METHODS, MethodHandler, SupervisorIpcServer, toIpcError(), endpointPath(), roundTrip(), TOKEN (+1 more)

### Community 25 - "Project Registry"
Cohesion: 0.16
Nodes (10): assertInsideRoot(), assertNoSymlinkOnPath(), BUILD_CAPABLE, canonicalize(), ProjectDefinition, ProjectError, ProjectRegistry, RegisteredProject (+2 more)

### Community 26 - "Registry"
Cohesion: 0.15
Nodes (17): deriveRiskLevel(), fileNameForCapabilityId(), loadCapabilities(), loadCompatibilityProfile(), loadErrors(), loadProfiles(), readYaml(), toolNameFor() (+9 more)

### Community 27 - "Backend"
Cohesion: 0.11
Nodes (9): assertBackendPairing(), BackendSecurityDowngradeError, BuildPlan, ExecutionBackend, ExecutionEnvironment, ProcessHandle, ResourceLimits, SourceSnapshot (+1 more)

### Community 28 - "Error Catalog File Schema"
Cohesion: 0.11
Nodes (18): additionalProperties, description, items, minItems, type, $id, $ref, errors (+10 more)

### Community 29 - "Package"
Cohesion: 0.11
Nodes (17): devDependencies, typescript, exports, ./schemas/*, files, typescript, main, name (+9 more)

### Community 30 - "Bridge Event Schema"
Cohesion: 0.11
Nodes (18): type, type, type, format, type, properties, bridge_boot_id, correlation_id (+10 more)

### Community 31 - "Package"
Cohesion: 0.11
Nodes (17): dependencies, @mcpdev/contracts, devDependencies, typescript, exports, @mcpdev/contracts, typescript, main (+9 more)

### Community 32 - "Types"
Cohesion: 0.17
Nodes (12): readMeta(), RequestMeta, ServerOptions, ADR-0002, ADR-0002, JSON_RPC, JsonRpcFailure, JsonRpcId (+4 more)

### Community 34 - "Index"
Cohesion: 0.14
Nodes (12): facade, guard, profile, server, shutdown(), transport, ADR-0003, installStdoutGuard() (+4 more)

### Community 35 - "Facade"
Cohesion: 0.16
Nodes (9): newCorrelationId(), placeholderDefinition(), toCallResult(), ToolCallResult, ToolContext, ToolDefinition, toolError(), ToolFacade (+1 more)

### Community 36 - "Source Snapshot"
Cohesion: 0.23
Nodes (12): assertSnapshotUnchanged(), collectEntries(), createSourceSnapshot(), DEFAULT_EXCLUDED_PATHS, diffEntries(), execFileAsync, fingerprintEntries(), GitInfo (+4 more)

### Community 38 - "Querydispatchertest"
Cohesion: 0.38
Nodes (3): DirectExecutor, Test, QueryDispatcherTest

### Community 39 - "Capability Schema"
Cohesion: 0.12
Nodes (16): additionalProperties, description, properties, type, minimum, type, limits, max_bytes (+8 more)

### Community 40 - "Index"
Cohesion: 0.12
Nodes (15): BACKEND_SECURITY_LEVEL, BridgeRequest, BridgeResponse, EventCursor, ExecutionBackendKind, MutationState, OperationState, ProvenanceChain (+7 more)

### Community 41 - "Error Schema"
Cohesion: 0.12
Nodes (16): type, retryable, suggested_action, is_error, retryable, suggested_action, tool_result, type (+8 more)

### Community 42 - "Capabilities Generated"
Cohesion: 0.12
Nodes (12): CAPABILITIES, CAPABILITY_IDS, CapabilityId, CapabilityMeta, CapabilityRisk, TOOL_TO_CAPABILITY, ERROR_CODES, ErrorCode (+4 more)

### Community 43 - "Scenario Schema"
Cohesion: 0.13
Nodes (15): stepName, $comment, $comment2, enum, type, actor.disconnect_all, assert.block, assert.event (+7 more)

### Community 44 - "Validate Schemas"
Cohesion: 0.14
Nodes (13): readJson(), ajv, caps, compile(), errors, exampleConfig, referenced, ROOT_SCHEMAS (+5 more)

### Community 45 - "Bridgeoperation"
Cohesion: 0.15
Nodes (11): BridgeOperation, EVENTS_QUERY, LOGS_QUERY, PLAYER_GET_STATE, PLUGIN_GET, PLUGIN_LIST, SERVER_GET_STATE, WORLD_GET_BLOCK (+3 more)

### Community 46 - "Paperreadoperations"
Cohesion: 0.24
Nodes (4): Override, Server, PaperReadOperations, World

### Community 47 - "Config Schema"
Cohesion: 0.14
Nodes (14): properties, default, enum, maximum, minimum, type, default_mode, max_output_bytes (+6 more)

### Community 48 - "Config Schema"
Cohesion: 0.14
Nodes (14): minLength, type, maximum, minimum, type, minLength, type, evidence_root (+6 more)

### Community 49 - "Error Schema"
Cohesion: 0.14
Nodes (13): additionalProperties, $id, code, required, $schema, title, type, category (+5 more)

### Community 50 - "Error Schema"
Cohesion: 0.14
Nodes (14): bridge, build, plugin, project, runtime, security, enum, actor (+6 more)

### Community 51 - "Package"
Cohesion: 0.14
Nodes (13): devDependencies, typescript, exports, typescript, main, name, private, scripts (+5 more)

### Community 52 - "Generate Contracts"
Cohesion: 0.14
Nodes (11): bridgeOps, capIds, caps, CHECK, drift, errCodes, errs, JAVA_DIR (+3 more)

### Community 53 - "Build Executor"
Cohesion: 0.24
Nodes (7): BuildExecutor, failure(), Diagnostic, DiagnosticSeverity, normalizePath(), parseDiagnostics(), suggestAction()

### Community 54 - "Bridgeruntimecontexttest"
Cohesion: 0.36
Nodes (3): BridgeRuntimeContext, BridgeRuntimeContextTest, Test

### Community 55 - "Capability Schema"
Cohesion: 0.15
Nodes (13): enum, approved-fixture, developer-workspace, pinned-source, revoked, untrusted, CREATED, NEW (+5 more)

### Community 56 - "Config Schema"
Cohesion: 0.15
Nodes (12): additionalProperties, minLength, type, description, $id, properties, compatibility_profile, version (+4 more)

### Community 57 - "Config Schema"
Cohesion: 0.15
Nodes (13): retention_hours, shutdown_timeout_seconds, startup_timeout_seconds, maximum, minimum, type, properties, maximum (+5 more)

### Community 58 - "System"
Cohesion: 0.23
Nodes (10): toolSuccess(), CompatibilityProfileShape, createSystemTools(), loadProfile(), NO_ARGS, profileWarnings(), ServerRuntimeInfo, TOOL_RESULT_SCHEMA_REF (+2 more)

### Community 59 - "Build Executor"
Cohesion: 0.26
Nodes (11): BuildExecutorOptions, BuildFailure, BuildOutcome, BuildProvenance, BuildRequest, BuildMode, NetworkPolicy, DiagnosticsSummary (+3 more)

### Community 60 - "Bridge Event Schema"
Cohesion: 0.17
Nodes (12): bridge_boot_id, correlation_id, run_id, server_instance_id, server_tick, required, data, event_id (+4 more)

### Community 61 - "Bridge Event Schema"
Cohesion: 0.17
Nodes (12): enum, block.break, block.place, bridge.action.completed, bridge.action.failed, bridge.action.started, player.command, player.join (+4 more)

### Community 62 - "Error Schema"
Cohesion: 0.17
Nodes (12): pattern, type, additionalProperties, properties, required, type, code, json_rpc_mapping (+4 more)

### Community 63 - "Error Schema"
Cohesion: 0.17
Nodes (12): CANCELLED, DIRTY, FAILED, null, ORPHANED, string, TIMED_OUT, UNKNOWN_OUTCOME (+4 more)

### Community 64 - "Artifact Selection"
Cohesion: 0.25
Nodes (9): ArtifactCandidate, ArtifactError, EXCLUDED_SUFFIXES, findArtifactCandidates(), OUTPUT_DIRS, selectArtifact(), SelectedArtifact, SelectOptions (+1 more)

### Community 65 - "Java Toolchain"
Cohesion: 0.35
Nodes (8): assertJavaMajor(), candidateJavaExecutable(), execFileAsync, JavaInstallation, JavaToolchainError, parseJavaMajor(), probeJava(), resolveJavaForProfile()

### Community 66 - "Querydispatcher"
Cohesion: 0.24
Nodes (3): QueryDispatcher, MainThreadExecutor, TimingOutExecutor

### Community 67 - "Config Schema"
Cohesion: 0.18
Nodes (11): additionalProperties, type, default, type, properties, container, enabled, trusted_local (+3 more)

### Community 68 - "Config Schema"
Cohesion: 0.18
Nodes (11): properties, maximum, minimum, type, default, maximum, minimum, type (+3 more)

### Community 69 - "Config Schema"
Cohesion: 0.18
Nodes (11): default, log_level, redact_patterns, stderr_format, minItems, type, default, enum (+3 more)

### Community 70 - "Config Schema"
Cohesion: 0.18
Nodes (11): runtime, additionalProperties, enum, required, type, docker, max_concurrent, podman (+3 more)

### Community 71 - "Error Schema"
Cohesion: 0.18
Nodes (11): enum, internal, timeout, conflict, environment, integrity, limit, not_found (+3 more)

### Community 72 - "Error Schema"
Cohesion: 0.18
Nodes (11): none, profile, enum, profile, redaction, additionalProperties, properties, required (+3 more)

### Community 73 - "Tsconfig"
Cohesion: 0.20
Nodes (9): compilerOptions, outDir, rootDir, extends, include, src/**/*.ts, test/**/*.ts, ../../tsconfig.base.json (+1 more)

### Community 75 - "Tsconfig"
Cohesion: 0.20
Nodes (9): compilerOptions, outDir, rootDir, extends, include, src/**/*.ts, test/**/*.ts, ../../tsconfig.base.json (+1 more)

### Community 76 - "Capability Schema"
Cohesion: 0.20
Nodes (10): additionalProperties, type, type, properties, contracts, milestone, notes, version (+2 more)

### Community 77 - "Capability Schema"
Cohesion: 0.20
Nodes (10): enum, D0, M0, M1, M2A, M2B, M3, V1 (+2 more)

### Community 78 - "Capability Schema"
Cohesion: 0.20
Nodes (10): requires, runtime_state, trust_level, additionalProperties, properties, type, items, type (+2 more)

### Community 79 - "Capability Schema"
Cohesion: 0.20
Nodes (10): risk, additionalProperties, required, type, approval, cost, effect, level (+2 more)

### Community 80 - "Config Schema"
Cohesion: 0.20
Nodes (10): additionalProperties, required, type, none, enum, build, default_mode, max_output_bytes (+2 more)

### Community 81 - "Config Schema"
Cohesion: 0.20
Nodes (10): build, security, version, required, compatibility_profile, execution, projects, storage (+2 more)

### Community 82 - "Config Schema"
Cohesion: 0.20
Nodes (10): enum, tool_profile, default, enum, debug, developer, error, info (+2 more)

### Community 83 - "Bridge Event Schema"
Cohesion: 0.20
Nodes (10): additionalProperties, description, properties, required, type, id, actor, id (+2 more)

### Community 84 - "Scenario Schema"
Cohesion: 0.20
Nodes (10): $defs, stepList, description, maxProperties, minProperties, propertyNames, $ref, items (+2 more)

### Community 85 - "Scenario Schema"
Cohesion: 0.20
Nodes (10): properties, world_key, x, y, z, pattern, type, type (+2 more)

### Community 86 - "Tsconfig"
Cohesion: 0.20
Nodes (9): compilerOptions, outDir, rootDir, extends, include, src/**/*.ts, test/**/*.ts, ../../tsconfig.base.json (+1 more)

### Community 87 - "Check Docs"
Cohesion: 0.20
Nodes (7): errors, files, ADR-0007, NEGATION, PLACEHOLDERS, SKIP_DIRS, warnings

### Community 88 - "Verify Compatibility"
Cohesion: 0.20
Nodes (9): PATHS, CHECKS, file, pending, profile, raw, REQUIRE_VERIFIED, verified (+1 more)

### Community 89 - "Stdio Transport"
Cohesion: 0.33
Nodes (3): StdioTransport, StdoutGuard, RequestHandler

### Community 91 - "Package"
Cohesion: 0.22
Nodes (8): description, files, capabilities, schema, name, private, version, profiles.yaml

### Community 92 - "Capability Schema"
Cohesion: 0.22
Nodes (9): items, type, integration, tests, additionalProperties, properties, required, type (+1 more)

### Community 93 - "Config Schema"
Cohesion: 0.22
Nodes (9): required, runtime, required, cpu, disk_mb, enabled, memory_mb, network_default (+1 more)

### Community 94 - "Scenario Schema"
Cohesion: 0.22
Nodes (9): id, profile, timeout, version, required, given, then, title (+1 more)

### Community 95 - "Error Schema"
Cohesion: 0.22
Nodes (9): description, minLength, type, type, properties, category, message, notes (+1 more)

### Community 97 - "Stdout Purity Test"
Cohesion: 0.25
Nodes (6): here, JsonRpcLike, META, repoRoot, serverEntry, ADR-0002

### Community 100 - "Capability Schema"
Cohesion: 0.25
Nodes (8): id, version, required, exposure, milestone, risk, summary, tests

### Community 101 - "Package"
Cohesion: 0.25
Nodes (7): description, files, schema, name, private, version, config.example.yaml

### Community 102 - "Config Schema"
Cohesion: 0.25
Nodes (8): pattern, type, repository_allowlist, items, items, minItems, type, uniqueItems

### Community 103 - "Config Schema"
Cohesion: 0.25
Nodes (8): storage, additionalProperties, required, type, evidence_root, max_total_gb, metadata_db, runtime_root

### Community 104 - "Bridge Event Schema"
Cohesion: 0.25
Nodes (8): bridge, plugin, enum, source, enum, console, paper, test_player

### Community 105 - "Scenario Schema"
Cohesion: 0.25
Nodes (8): position, additionalProperties, required, type, world_key, x, y, z

### Community 106 - "Scenario Schema"
Cohesion: 0.25
Nodes (8): capabilities, type, plugin_contract, requires, additionalProperties, properties, required, type

### Community 108 - "Tsconfig"
Cohesion: 0.25
Nodes (7): compilerOptions, outDir, rootDir, extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 109 - "Package"
Cohesion: 0.25
Nodes (7): description, files, errors, schema, name, private, version

### Community 110 - "Error Schema"
Cohesion: 0.25
Nodes (8): additionalProperties, properties, type, maximum, minimum, type, bridge_mapping, http_status

### Community 111 - "Error Schema"
Cohesion: 0.25
Nodes (8): pattern, type, removed_fields, tests, items, type, items, type

### Community 112 - "Tsconfig"
Cohesion: 0.25
Nodes (7): compilerOptions, outDir, rootDir, extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 113 - "Check Parse"
Cohesion: 0.29
Nodes (7): checkMarkdown(), errors, SKIP_DIRS, walk(), fail(), ok(), ROOT

### Community 114 - "Papermainthreadexecutor"
Cohesion: 0.48
Nodes (4): Override, Server, PaperMainThreadExecutor, Plugin

### Community 115 - "Capability Schema"
Cohesion: 0.29
Nodes (6): additionalProperties, description, $id, $schema, title, type

### Community 116 - "Capability Schema"
Cohesion: 0.29
Nodes (7): items, type, type, capabilities, unit, items, type

### Community 117 - "Capability Schema"
Cohesion: 0.29
Nodes (7): items, type, items, type, pattern, contract, e2e

### Community 118 - "Capability Schema"
Cohesion: 0.29
Nodes (7): status, default, enum, conditional, deferred, implemented, planned

### Community 119 - "Config Schema"
Cohesion: 0.29
Nodes (7): telemetry, additionalProperties, required, type, log_level, redact_patterns, stderr_format

### Community 120 - "Scenario Schema"
Cohesion: 0.29
Nodes (6): additionalProperties, description, $id, $schema, title, type

### Community 121 - "Endpoint"
Cohesion: 0.48
Nodes (6): controlDir(), controlFilePath(), controlUserSlug(), readControlFile(), safeUser(), SupervisorEndpoint

### Community 122 - "Bridge Event Schema"
Cohesion: 0.33
Nodes (5): additionalProperties, $id, $schema, title, type

### Community 123 - "Bridge Event Schema"
Cohesion: 0.33
Nodes (6): type, type, null, string, causation_id, object

### Community 124 - "Tool Result Schema"
Cohesion: 0.33
Nodes (5): description, $id, oneOf, $schema, title

### Community 125 - "Scenario Schema"
Cohesion: 0.33
Nodes (6): items, minItems, type, pattern, type, capabilities

### Community 127 - "Config Schema"
Cohesion: 0.40
Nodes (5): default, maximum, minimum, type, max_concurrent

### Community 128 - "Gradlew"
Cohesion: 0.83
Nodes (3): gradlew script, die(), warn()

### Community 129 - "Capability Schema"
Cohesion: 0.50
Nodes (4): description, items, type, errors

### Community 130 - "Capability Schema"
Cohesion: 0.50
Nodes (4): description, pattern, type, id

### Community 131 - "Capability Schema"
Cohesion: 0.50
Nodes (4): summary, description, minLength, type

### Community 132 - "Config Schema"
Cohesion: 0.50
Nodes (4): maximum, minimum, type, cpu

### Community 133 - "Config Schema"
Cohesion: 0.50
Nodes (4): maximum, minimum, type, disk_mb

### Community 135 - "Capability Schema"
Cohesion: 0.67
Nodes (3): minimum, type, max_blocks

### Community 136 - "Capability Schema"
Cohesion: 0.67
Nodes (3): minimum, type, max_results

### Community 137 - "Capability Schema"
Cohesion: 0.67
Nodes (3): security, items, type

### Community 138 - "Bridge Event Schema"
Cohesion: 0.67
Nodes (3): pattern, type, event_id

### Community 139 - "Bridge Event Schema"
Cohesion: 0.67
Nodes (3): server_tick, minimum, type

## Knowledge Gaps
- **1069 isolated node(s):** `name`, `version`, `private`, `type`, `minecraft-plugin-dev-mcp` (+1064 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **10 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `runtime` connect `Config Schema` to `Bridge Boot Identity`, `Config Schema`, `Paperreadoperations`, `Config Schema`, `Config Schema`?**
  _High betweenness centrality (0.039) - this node is a cross-community bridge._
- **Why does `properties` connect `Config Schema` to `Config Schema`, `Config Schema`, `JSON Schema Primitives`, `Config Numeric Bounds`, `Config Schema`, `Config Schema`, `Config Schema`?**
  _High betweenness centrality (0.030) - this node is a cross-community bridge._
- **Why does `PaperBridgePlugin` connect `Bridge Boot Identity` to `Bridge Auth and Endpoints`, `Bridgeruntimecontexttest`?**
  _High betweenness centrality (0.024) - this node is a cross-community bridge._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _1069 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Error Catalog Codes` be split into smaller, more focused modules?**
  _Cohesion score 0.01818181818181818 - nodes in this community are weakly interconnected._
- **Should `Bridge Boot Identity` be split into smaller, more focused modules?**
  _Cohesion score 0.05518207282913165 - nodes in this community are weakly interconnected._
- **Should `Bridge Auth and Endpoints` be split into smaller, more focused modules?**
  _Cohesion score 0.059720869847452125 - nodes in this community are weakly interconnected._