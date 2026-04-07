import { spawn } from "child_process"
import fs from "fs/promises"
import path from "path"
import YAML from "yaml"
import type { RunConfig, ServiceConfig, Healthcheck, PortMapping } from "./types"

// ---------------------------------------------------------------------------
// Shell exec helpers
// ---------------------------------------------------------------------------

function exec(
  command: string,
  args: string[],
  opts?: { cwd?: string; timeout?: number }
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      cwd: opts?.cwd,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: opts?.timeout,
    })
    let stdout = ""
    let stderr = ""
    proc.stdout.on("data", (d: Buffer) => { stdout += d.toString() })
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString() })
    proc.on("close", (code) => resolve({ stdout, stderr, exitCode: code ?? 1 }))
    proc.on("error", (err) => resolve({ stdout, stderr: err.message, exitCode: 1 }))
  })
}

function execStream(
  command: string,
  args: string[],
  opts: { cwd?: string; timeout?: number },
  onOutput?: (line: string) => void
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      cwd: opts?.cwd,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: opts?.timeout,
    })
    let stdout = ""
    let stderr = ""
    const handle = (text: string) => {
      if (onOutput) {
        for (const line of text.split("\n")) {
          const t = line.trim()
          if (t) onOutput(t)
        }
      }
    }
    proc.stdout.on("data", (d: Buffer) => { const t = d.toString(); stdout += t; handle(t) })
    proc.stderr.on("data", (d: Buffer) => { const t = d.toString(); stderr += t; handle(t) })
    proc.on("close", (code) => resolve({ stdout, stderr, exitCode: code ?? 1 }))
    proc.on("error", (err) => resolve({ stdout, stderr: err.message, exitCode: 1 }))
  })
}

// ---------------------------------------------------------------------------
// Compose generation
// ---------------------------------------------------------------------------

interface ComposeService {
  image?: string
  entrypoint?: string[]
  environment?: Record<string, string>
  ports?: string[]
  healthcheck?: { test: string[]; interval: string; timeout: string; retries: number }
  depends_on?: Record<string, { condition: string }>
  volumes?: string[]
  command?: string[]
  working_dir?: string
}

function convertHealthcheck(hc: Healthcheck): ComposeService["healthcheck"] {
  let test: string[]
  switch (hc.type) {
    case "http":
      test = ["CMD-SHELL", `wget --spider -q http://localhost:${hc.port}${hc.path} || curl -sf http://localhost:${hc.port}${hc.path} > /dev/null || node -e "fetch('http://localhost:${hc.port}${hc.path}').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"`]
      break
    case "command":
      test = ["CMD", ...hc.command]
      break
    case "tcp":
      test = ["CMD-SHELL", `nc -z localhost ${hc.port} || exit 1`]
      break
  }
  return {
    test,
    interval: `${hc.interval ?? 5}s`,
    timeout: `${hc.timeout ?? 10}s`,
    retries: hc.retries ?? 5,
  }
}

function convertPorts(ports?: PortMapping[]): { composePorts: string[]; portMap: Record<number, number> } {
  const composePorts: string[] = []
  const portMap: Record<number, number> = {}
  if (!ports) return { composePorts, portMap }

  for (const p of ports) {
    if (typeof p.host === "number") {
      composePorts.push(`${p.host}:${p.container}`)
      portMap[p.container] = p.host
    }
  }
  return { composePorts, portMap }
}

function serviceToCompose(
  name: string,
  svc: ServiceConfig,
  allServices: Record<string, ServiceConfig>,
  allInfra: Record<string, ServiceConfig>
): { compose: ComposeService; portMap: Record<number, number> } {
  const cs: ComposeService = { image: svc.image }

  if (svc.env) cs.environment = svc.env

  const { composePorts, portMap } = convertPorts(svc.ports)
  if (composePorts.length > 0) cs.ports = composePorts

  if (svc.healthcheck) cs.healthcheck = convertHealthcheck(svc.healthcheck)
  if (svc.volumes) cs.volumes = svc.volumes

  if (svc.dependsOn) {
    cs.depends_on = {}
    for (const dep of svc.dependsOn) {
      const depCfg = allServices[dep] ?? allInfra[dep]
      cs.depends_on[dep] = {
        condition: depCfg?.healthcheck ? "service_healthy" : "service_started",
      }
    }
  }

  return { compose: cs, portMap }
}

export function generateComposeFile(
  config: RunConfig,
  runId: string,
  testCommand?: string[],
  testScriptPath?: string,
  jmeterScriptPath?: string
): { yaml: string; portMaps: Record<string, Record<number, number>> } {
  const projectName = `tp-${runId}`
  const services: Record<string, ComposeService> = {}
  const portMaps: Record<string, Record<number, number>> = {}

  const allServices = config.services
  const allInfra = config.infra ?? {}

  // Infrastructure
  for (const [name, svc] of Object.entries(allInfra)) {
    const { compose, portMap } = serviceToCompose(name, svc, allServices, allInfra)
    services[name] = compose
    portMaps[name] = portMap
  }

  // Application services
  for (const [name, svc] of Object.entries(allServices)) {
    const { compose, portMap } = serviceToCompose(name, svc, allServices, allInfra)
    services[name] = compose
    portMaps[name] = portMap
  }

  // Test runner
  const testSvc: ComposeService = {}

  if ("httpChecks" in config.test) {
    testSvc.image = "node:20-slim"
    testSvc.command = ["node", "/test-script.mjs"]
    testSvc.volumes = []
    if (testScriptPath) {
      testSvc.volumes.push(`${testScriptPath}:/test-script.mjs:ro`)
    }
  } else if ("jmeter" in config.test) {
    const jm = config.test.jmeter
    testSvc.image = jm.image ?? "justb4/jmeter:latest"
    testSvc.entrypoint = ["/bin/sh"]
    testSvc.command = ["/tests/run-jmeter.sh"]
    testSvc.volumes = []
    if (jmeterScriptPath) {
      testSvc.volumes.push(`${jmeterScriptPath}:/tests/run-jmeter.sh:ro`)
    }
    testSvc.volumes.push(`${jm.testPlan}:/tests/test-plan.jmx:ro`)
  } else if ("cucumber" in config.test) {
    const cu = config.test.cucumber
    testSvc.image = cu.image ?? "ghcr.io/iazzam-bornan/test-platform-cucumber-runner:latest"
    // Use the image's built-in entrypoint — no override needed
    testSvc.environment = {
      BASE_URL: cu.baseUrl ?? "http://localhost",
      BROWSER: cu.browser ?? "chromium",
      HEADLESS: cu.headless === false ? "false" : "true",
      ...(cu.tags ? { TAGS: cu.tags } : {}),
      ...(cu.env ?? {}),
    }

    if (cu.streamBrowser) {
      testSvc.environment.STREAM_BROWSER = "true"
      testSvc.environment.STREAM_INTERACTIVE = cu.streamInteractive ? "true" : "false"
      // Expose noVNC port 6080 with a random host port. The "127.0.0.1::6080"
      // short-form means: bind to localhost, no fixed host port (random),
      // mapped to container port 6080. Avoids collisions across parallel runs.
      testSvc.ports = testSvc.ports ?? []
      testSvc.ports.push("127.0.0.1::6080")
    }

    if (cu.repo) {
      // Repo mode: clone inside the container, no volumes
      testSvc.environment.GIT_REPO_URL = cu.repo.url
      testSvc.environment.GIT_REPO_REF = cu.repo.ref ?? "main"
      testSvc.environment.MODULES = cu.repo.modules.join(",")
      if (cu.repo.token) {
        testSvc.environment.GIT_TOKEN = cu.repo.token
      }
    } else if (cu.features) {
      // Local mode: mount features and steps as volumes
      testSvc.volumes = [`${cu.features}:/project/features:ro`]
      if (cu.steps) {
        testSvc.volumes.push(`${cu.steps}:/project/steps:ro`)
      }
    }
  } else {
    testSvc.image = config.test.image
    if (config.test.entrypoint) testSvc.entrypoint = config.test.entrypoint
    testSvc.command = config.test.command
    if (config.test.env) testSvc.environment = config.test.env
    if (config.test.volumes) testSvc.volumes = config.test.volumes
  }

  // Test runner depends on everything
  const allDeps = [...Object.keys(allInfra), ...Object.keys(allServices)]
  if (allDeps.length > 0) {
    testSvc.depends_on = {}
    for (const dep of allDeps) {
      const depCfg = allServices[dep] ?? allInfra[dep]
      testSvc.depends_on[dep] = {
        condition: depCfg?.healthcheck ? "service_healthy" : "service_started",
      }
    }
  }

  services["test-runner"] = testSvc

  const compose = {
    name: projectName,
    services,
    networks: { default: { name: `${projectName}-net` } },
  }

  return { yaml: YAML.stringify(compose), portMaps }
}

// ---------------------------------------------------------------------------
// Docker operations
// ---------------------------------------------------------------------------

export async function isDockerAvailable(): Promise<boolean> {
  const r = await exec("docker", ["info"])
  return r.exitCode === 0
}

export async function composeUp(
  cwd: string,
  projectName: string,
  onOutput?: (line: string) => void
): Promise<{ exitCode: number; stderr: string }> {
  const r = await execStream(
    "docker",
    ["compose", "-p", projectName, "up", "-d", "--pull", "always"],
    { cwd, timeout: 600_000 },
    onOutput
  )
  return { exitCode: r.exitCode, stderr: r.stderr }
}

export async function composeDown(
  cwd: string,
  projectName: string
): Promise<void> {
  await exec("docker", ["compose", "-p", projectName, "down", "-v", "--remove-orphans"], { cwd })
}

export async function getContainerIds(
  projectName: string
): Promise<Record<string, string>> {
  const r = await exec("docker", [
    "compose", "-p", projectName, "ps", "-a", "--format", "{{.Service}}={{.ID}}",
  ])
  const map: Record<string, string> = {}
  if (r.exitCode === 0) {
    for (const line of r.stdout.trim().split("\n")) {
      const [svc, id] = line.split("=")
      if (svc && id) map[svc] = id
    }
  }
  return map
}

/**
 * Look up the host-side TCP address a container's port is mapped to.
 * Returns null if the container isn't running or the port isn't mapped.
 *
 * Uses `docker port <id> <port>` which prints lines like:
 *   0.0.0.0:32768
 *   [::]:32768
 */
export async function getContainerHostPort(
  containerId: string,
  containerPort: number
): Promise<{ host: string; port: number } | null> {
  const r = await exec("docker", ["port", containerId, String(containerPort)])
  if (r.exitCode !== 0) return null
  const lines = r.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
  if (lines.length === 0) return null

  // Prefer an IPv4 mapping over IPv6 — easier for the local API to dial.
  // Lines look like: "0.0.0.0:32768" or "[::]:32768" or "127.0.0.1:32768"
  const ipv4 = lines.find((l) => !l.startsWith("[")) ?? lines[0]
  // Strip optional [::] prefix
  const cleaned = ipv4.startsWith("[") ? ipv4.replace(/^\[[^\]]*\]:/, "") : ipv4

  // Split host:port (last ":" is the port separator)
  const lastColon = cleaned.lastIndexOf(":")
  if (lastColon === -1) {
    // Just a port
    const port = parseInt(cleaned, 10)
    if (isNaN(port)) return null
    return { host: "127.0.0.1", port }
  }

  const host = cleaned.slice(0, lastColon)
  const port = parseInt(cleaned.slice(lastColon + 1), 10)
  if (isNaN(port)) return null

  // Rewrite 0.0.0.0 / empty to 127.0.0.1 so the local API can dial it
  const realHost = !host || host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host
  return { host: realHost, port }
}

export async function getContainerHealth(
  containerId: string
): Promise<"starting" | "healthy" | "unhealthy" | "none"> {
  const r = await exec("docker", [
    "inspect", "--format",
    "{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}",
    containerId,
  ])
  const s = r.stdout.trim()
  if (s === "healthy" || s === "unhealthy" || s === "starting") return s
  return "none"
}

export async function isContainerRunning(containerId: string): Promise<boolean> {
  const r = await exec("docker", ["inspect", "--format", "{{.State.Running}}", containerId])
  return r.stdout.trim() === "true"
}

export async function getContainerExitCode(containerId: string): Promise<number | null> {
  const r = await exec("docker", ["inspect", "--format", "{{.State.ExitCode}}", containerId])
  if (r.exitCode !== 0) return null
  const code = parseInt(r.stdout.trim(), 10)
  return isNaN(code) ? null : code
}

export async function getContainerLogs(containerId: string): Promise<string> {
  const r = await exec("docker", ["logs", "--timestamps", containerId])
  return r.stdout + r.stderr
}

export function streamContainerLogs(
  containerId: string,
  onStdout: (line: string) => void,
  onStderr: (line: string) => void
): () => void {
  const proc = spawn("docker", ["logs", "-f", containerId], {
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
  })
  const handle = (cb: (l: string) => void) => (d: Buffer) => {
    for (const line of d.toString().split("\n")) {
      const t = line.trim()
      if (t) cb(t)
    }
  }
  proc.stdout.on("data", handle(onStdout))
  proc.stderr.on("data", handle(onStderr))
  return () => { try { proc.kill() } catch {} }
}

export async function writeFile(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, content, "utf-8")
}
