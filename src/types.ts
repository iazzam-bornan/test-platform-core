// ---------------------------------------------------------------------------
// Config types -- what the user passes in
// ---------------------------------------------------------------------------

export interface ServiceConfig {
  image: string
  env?: Record<string, string>
  ports?: PortMapping[]
  healthcheck?: Healthcheck
  dependsOn?: string[]
  volumes?: string[]
}

export interface PortMapping {
  container: number
  host?: number // omit or undefined = internal only
}

export type Healthcheck =
  | { type: "http"; path: string; port: number; interval?: number; timeout?: number; retries?: number }
  | { type: "command"; command: string[]; interval?: number; timeout?: number; retries?: number }
  | { type: "tcp"; port: number; interval?: number; timeout?: number; retries?: number }

export interface HttpCheckTest {
  httpChecks: string[]
  iterations?: number  // default 10
  delayMs?: number     // default 1000
}

export interface CustomContainerTest {
  image: string
  entrypoint?: string[]
  command: string[]
  env?: Record<string, string>
  volumes?: string[]
}

export interface JmeterTest {
  jmeter: {
    testPlan: string
    image?: string
    threads?: number
    rampUp?: number
    loops?: number
    duration?: number
    errorThreshold?: number
    properties?: Record<string, string>
  }
}

export interface CucumberTest {
  cucumber: {
    // Mode A: local files
    features?: string                                   // host path to features dir
    steps?: string                                      // host path to steps dir
    // Mode B: clone from a git repo (modular tests)
    repo?: {
      url: string                                       // e.g. "https://github.com/myorg/e2e-tests.git"
      ref?: string                                      // branch/tag/sha (default "main")
      modules: string[]                                 // module names to load
      token?: string                                    // optional auth token for private repos
    }
    // Common
    image?: string                                      // default "ghcr.io/iazzam-bornan/test-platform-cucumber-runner:latest"
    baseUrl?: string                                    // injected as BASE_URL env var
    browser?: "chromium" | "firefox" | "webkit"         // default "chromium"
    headless?: boolean                                  // default true
    tags?: string                                       // --tags filter
    env?: Record<string, string>                        // additional env vars
    /**
     * When true, runs the browser non-headless inside a VNC server so the
     * platform can stream the live browser view to the UI. Adds ~20-30%
     * runtime overhead (non-headless is slower). Chromium works best;
     * Firefox works with caveats; webkit support is experimental.
     * Default: false.
     */
    streamBrowser?: boolean
    /**
     * When true (and streamBrowser is on), the frontend viewer forwards
     * mouse and keyboard input to the streamed browser. Use carefully —
     * interacting with a running test can cause it to fail.
     * Default: false (read-only view).
     */
    streamInteractive?: boolean
    /**
     * When true (and streamBrowser is on), launches a full Linux desktop
     * inside the test runner container — window manager, terminal, file
     * manager — instead of just a fullscreen browser. Lets you poke
     * around the container as if it was a remote machine. Useful for
     * debugging cloned test repos, inspecting `/results`, etc.
     * Default: false.
     */
    streamDesktop?: boolean
  }
}

export type TestConfig = HttpCheckTest | CustomContainerTest | JmeterTest | CucumberTest

export interface CleanupConfig {
  onPass?: "destroy" | "preserve"   // default "destroy"
  onFail?: "destroy" | "preserve"   // default "destroy"
}

export interface RunConfig {
  services: Record<string, ServiceConfig>
  infra?: Record<string, ServiceConfig>
  test: TestConfig
  cleanup?: CleanupConfig
}

// ---------------------------------------------------------------------------
// Runtime types -- what the platform emits and stores
// ---------------------------------------------------------------------------

export type RunStatus =
  | "queued"
  | "pending"
  | "booting"
  | "waiting_healthy"
  | "testing"
  | "passed"
  | "failed"
  | "cancelled"
  | "error"
  | "cleaning_up"

export type ServiceHealth = "unknown" | "starting" | "healthy" | "unhealthy"

export interface ServiceState {
  name: string
  image: string
  containerId?: string
  health: ServiceHealth
  ports: Record<number, number> // container port -> host port
}

export interface TestResult {
  url?: string
  iteration?: number
  status?: number | string
  ok?: boolean
  duration?: number
  timestamp?: string
  error?: string
  body?: string
  // summary or plan
  type?: "summary" | "plan"
  totalChecks?: number
  passed?: number
  failed?: number
  passRate?: number
  // jmeter fields
  label?: string
  responseCode?: string
  responseMessage?: string
  threadName?: string
  bytes?: number
  sentBytes?: number
  connectTime?: number
  latency?: number
  // jmeter summary fields
  errorRate?: number
  avgDuration?: number
  minDuration?: number
  maxDuration?: number
  p90Duration?: number
  p95Duration?: number
  throughput?: number
  // cucumber fields
  feature?: string
  scenario?: string
  tags?: string[]
  steps?: CucumberStepResult[]
  attachments?: CucumberAttachment[]
  // cucumber summary extras
  skipped?: number
}

export interface CucumberStepResult {
  keyword: string
  text: string
  status: string
  duration: number
  error?: string
}

export interface CucumberAttachment {
  mimeType: string
  data: string
}

export interface RunState {
  id: string
  status: RunStatus
  config: RunConfig
  services: ServiceState[]
  startedAt: string
  finishedAt?: string
  exitCode?: number
  error?: string
  logs: string[]
  testResults: TestResult[]
  serviceLogs: Record<string, string>
  /**
   * Total number of expected test results, declared by the test runner via a
   * "plan" result event before any actual results stream in. Allows the
   * frontend to render an accurate progress denominator. Undefined if the
   * runner did not (or could not) emit a plan event.
   */
  plannedTotal?: number
  /**
   * For runs in the "queued" status, the 1-indexed position in the queue.
   * Updated whenever the queue shifts. Undefined for runs that have started.
   */
  queuePosition?: number
}

/**
 * Snapshot of the platform's queue at a point in time.
 */
export interface QueueStatus {
  active: number
  queued: number
  max: number
}

// ---------------------------------------------------------------------------
// Events -- what the platform emits
// ---------------------------------------------------------------------------

export interface PlatformEvents {
  "status": (runId: string, status: RunStatus) => void
  "log": (runId: string, line: string) => void
  "result": (runId: string, result: TestResult) => void
  "service:health": (runId: string, service: string, health: ServiceHealth) => void
  "finished": (runId: string, state: RunState) => void
  "queue:changed": (status: QueueStatus) => void
}

// ---------------------------------------------------------------------------
// Storage interface -- pluggable persistence
// ---------------------------------------------------------------------------

export interface Storage {
  saveRun(state: RunState): Promise<void>
  getRun(id: string): Promise<RunState | null>
  listRuns(opts?: { status?: RunStatus; limit?: number }): Promise<RunState[]>
  updateRun(id: string, patch: Partial<RunState>): Promise<void>
  deleteRun(id: string): Promise<void>
}

// ---------------------------------------------------------------------------
// Platform options
// ---------------------------------------------------------------------------

export interface PlatformOptions {
  workspaceDir?: string       // temp dir for compose files, default os.tmpdir()
  storage?: Storage           // default: in-memory
  /**
   * Maximum number of runs that can hold a docker resource slot at once.
   * When the limit is reached, additional runs are queued (FIFO) until a
   * slot frees up. Slots are released only after the run's docker stack is
   * fully torn down (or destroyed, for preserved environments).
   *
   * Defaults to 0 (unlimited), which preserves the previous behavior.
   *
   * Can be changed at runtime via `platform.setMaxConcurrentRuns(n)`.
   */
  maxConcurrentRuns?: number
}
