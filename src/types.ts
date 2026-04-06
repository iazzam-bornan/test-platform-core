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
    features: string                                    // host path to features dir
    steps?: string                                      // host path to steps dir
    image?: string                                      // default "testplatform/cucumber-runner:latest"
    baseUrl?: string                                    // injected as BASE_URL env var
    browser?: "chromium" | "firefox" | "webkit"         // default "chromium"
    headless?: boolean                                  // default true
    tags?: string                                       // --tags filter
    env?: Record<string, string>                       // additional env vars
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
  status?: number
  ok?: boolean
  duration?: number
  timestamp?: string
  error?: string
  body?: string
  // summary
  type?: "summary"
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
  workspaceDir?: string  // temp dir for compose files, default os.tmpdir()
  storage?: Storage      // default: in-memory
}
