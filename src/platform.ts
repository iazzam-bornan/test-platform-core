import { EventEmitter } from "events"
import os from "os"
import path from "path"
import type {
  RunConfig,
  RunState,
  RunStatus,
  PlatformEvents,
  PlatformOptions,
  QueueStatus,
  Storage,
} from "./types"
import { Run } from "./run"
import { MemoryStorage } from "./storage/memory"
import { isDockerAvailable } from "./docker"

export class TestPlatform {
  private emitter = new EventEmitter()
  private storage: Storage
  private workspaceDir: string
  private maxConcurrent: number

  /**
   * Runs that currently hold a docker resource slot. Includes both
   * actively-executing runs AND finished-but-preserved runs (whose stack is
   * still up). Slot is released only when the docker stack is fully torn down.
   */
  private slottedRuns = new Set<string>()

  /** Active (executing) runs, indexed by id. Subset of `slottedRuns`. */
  private activeRuns = new Map<string, Run>()

  /** FIFO queue of runs waiting for a slot. */
  private queue: Run[] = []

  /** Re-entrancy guard for queue draining. */
  private draining = false

  constructor(opts?: PlatformOptions) {
    this.storage = opts?.storage ?? new MemoryStorage()
    this.workspaceDir = opts?.workspaceDir ?? path.join(os.tmpdir(), "testplatform-runs")
    this.maxConcurrent = opts?.maxConcurrentRuns ?? 0
  }

  // ---- Event subscription ----

  on<E extends keyof PlatformEvents>(event: E, listener: PlatformEvents[E]): this {
    this.emitter.on(event, listener as (...args: unknown[]) => void)
    return this
  }

  off<E extends keyof PlatformEvents>(event: E, listener: PlatformEvents[E]): this {
    this.emitter.off(event, listener as (...args: unknown[]) => void)
    return this
  }

  // ---- Queue management ----

  /**
   * Update the maximum number of concurrent runs at runtime.
   * Setting to 0 means unlimited. If raised, queued runs may immediately
   * start. If lowered, in-flight runs continue but no new ones start until
   * the active count drops below the new limit.
   */
  async setMaxConcurrentRuns(max: number): Promise<void> {
    if (max < 0 || !Number.isFinite(max)) {
      throw new Error(`Invalid maxConcurrentRuns: ${max}`)
    }
    this.maxConcurrent = Math.floor(max)
    this.emitQueueChanged()
    await this.tryDrainQueue()
  }

  /** Returns the current max concurrent runs setting (0 = unlimited). */
  getMaxConcurrentRuns(): number {
    return this.maxConcurrent
  }

  /** Snapshot of the current queue state. */
  getQueueStatus(): QueueStatus {
    return {
      active: this.slottedRuns.size,
      queued: this.queue.length,
      max: this.maxConcurrent,
    }
  }

  private hasFreeSlot(): boolean {
    if (this.maxConcurrent === 0) return true
    return this.slottedRuns.size < this.maxConcurrent
  }

  private emitQueueChanged(): void {
    this.emitter.emit("queue:changed", this.getQueueStatus())
  }

  private async refreshQueuePositions(): Promise<void> {
    for (let i = 0; i < this.queue.length; i++) {
      this.queue[i].setQueuePosition(i + 1)
      await this.storage.saveRun(this.queue[i].getState()).catch(() => {})
    }
  }

  /**
   * Whether a finished run was preserved (still holds its docker stack).
   */
  private wasPreserved(state: RunState): boolean {
    const cleanup = state.config.cleanup
    if (!cleanup) return false
    if (state.status === "passed" && cleanup.onPass === "preserve") return true
    if (
      (state.status === "failed" || state.status === "error") &&
      cleanup.onFail === "preserve"
    ) {
      return true
    }
    return false
  }

  /**
   * Drain the queue: start as many waiting runs as there are free slots.
   * Re-entrancy safe via the `draining` flag.
   */
  private async tryDrainQueue(): Promise<void> {
    if (this.draining) return
    this.draining = true
    try {
      while (this.hasFreeSlot() && this.queue.length > 0) {
        const next = this.queue.shift()!
        next.clearQueuePosition()
        await this.startRun(next)
      }
      await this.refreshQueuePositions()
      this.emitQueueChanged()
    } finally {
      this.draining = false
    }
  }

  /**
   * Begin executing a run that has been allocated a slot.
   * Adds to slottedRuns + activeRuns and kicks off background execution.
   */
  private async startRun(run: Run): Promise<void> {
    this.slottedRuns.add(run.id)
    this.activeRuns.set(run.id, run)
    await this.storage.saveRun(run.getState()).catch(() => {})

    // Execute in background; release slot only after teardown completes
    run.execute().finally(async () => {
      this.activeRuns.delete(run.id)
      const finalState = run.getState()
      const preserved = this.wasPreserved(finalState)
      if (!preserved) {
        // Stack is gone — release the slot and try to start a queued run
        this.slottedRuns.delete(run.id)
        this.emitQueueChanged()
        await this.tryDrainQueue()
      } else {
        // Slot stays held until destroyRun() is called explicitly
        this.emitQueueChanged()
      }
    })
  }

  // ---- Run management ----

  /**
   * Create a new run. If a slot is available, the run begins executing
   * immediately. Otherwise it is queued (FIFO) until a slot frees up.
   * Returns the Run handle in either case.
   */
  async createRun(config: RunConfig): Promise<Run> {
    const id = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const run = new Run(id, config, this.emitter, this.storage, this.workspaceDir)

    if (this.hasFreeSlot()) {
      await this.startRun(run)
      this.emitQueueChanged()
    } else {
      this.queue.push(run)
      run.setQueuedState(this.queue.length)
      await this.storage.saveRun(run.getState()).catch(() => {})
      this.emitter.emit("status", run.id, "queued")
      this.emitQueueChanged()
    }

    return run
  }

  /**
   * Get an active run by ID (only works for in-progress runs).
   */
  getActiveRun(id: string): Run | undefined {
    return this.activeRuns.get(id)
  }

  /**
   * Get all active run IDs.
   */
  getActiveRunIds(): string[] {
    return [...this.activeRuns.keys()]
  }

  /**
   * Cancel a run. Handles three cases:
   *   1. Active (executing): tear down its docker stack
   *   2. Queued (not yet started): remove from queue, mark cancelled
   *   3. Orphaned (lost from memory after restart): try to tear down lingering containers
   */
  async cancelRun(id: string): Promise<void> {
    // Case 1: Active run
    const run = this.activeRuns.get(id)
    if (run) {
      await run.cancel()
      // run.cancel() does composeDown internally; release the slot
      this.slottedRuns.delete(id)
      this.emitQueueChanged()
      await this.tryDrainQueue()
      return
    }

    // Case 2: Queued run
    const queueIdx = this.queue.findIndex((r) => r.id === id)
    if (queueIdx !== -1) {
      const [queuedRun] = this.queue.splice(queueIdx, 1)
      queuedRun.setCancelledFromQueue()
      await this.storage.saveRun(queuedRun.getState()).catch(() => {})
      this.emitter.emit("status", id, "cancelled")
      // Update positions of runs still in the queue
      await this.refreshQueuePositions()
      this.emitQueueChanged()
      return
    }

    // Case 3: Orphaned run
    const stored = await this.storage.getRun(id)
    if (stored) {
      const terminal = ["passed", "failed", "cancelled", "error"]
      if (!terminal.includes(stored.status)) {
        const { composeDown } = await import("./docker")
        await composeDown(
          path.join(this.workspaceDir, id),
          `tp-${id}`
        ).catch(() => {})

        await this.storage.updateRun(id, {
          status: "cancelled",
          finishedAt: new Date().toISOString(),
          logs: [...stored.logs, `[${new Date().toISOString()}] Cancelled (orphaned run after restart)`],
        })
      }
    }
  }

  /**
   * Destroy a preserved environment from a finished run.
   * Releases its slot so the next queued run can start.
   */
  async destroyRun(id: string): Promise<void> {
    const active = this.activeRuns.get(id)
    if (active) {
      await active.destroy()
      this.slottedRuns.delete(id)
      this.emitQueueChanged()
      await this.tryDrainQueue()
      return
    }

    // For finished runs, try to compose down just in case
    const { composeDown } = await import("./docker")
    await composeDown(
      path.join(this.workspaceDir, id),
      `tp-${id}`
    ).catch(() => {})

    // Release the slot if this run was holding one (preserved finished run)
    if (this.slottedRuns.has(id)) {
      this.slottedRuns.delete(id)
      this.emitQueueChanged()
      await this.tryDrainQueue()
    }
  }

  // ---- Storage queries ----

  async getRun(id: string): Promise<RunState | null> {
    // In-memory state has the freshest data
    const active = this.activeRuns.get(id)
    if (active) return active.getState()

    const queued = this.queue.find((r) => r.id === id)
    if (queued) return queued.getState()

    return this.storage.getRun(id)
  }

  async listRuns(opts?: { status?: RunStatus; limit?: number }): Promise<RunState[]> {
    const dbRuns = await this.storage.listRuns(opts)

    // Merge in-memory state (active + queued) — they have fresher data
    const merged = new Map<string, RunState>()
    for (const run of dbRuns) {
      merged.set(run.id, run)
    }
    for (const [id, run] of this.activeRuns) {
      const state = run.getState()
      if (!opts?.status || state.status === opts.status) {
        merged.set(id, state)
      }
    }
    for (const run of this.queue) {
      const state = run.getState()
      if (!opts?.status || state.status === opts.status) {
        merged.set(run.id, state)
      }
    }

    let result = [...merged.values()]
    result.sort((a, b) =>
      new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    )

    if (opts?.limit) {
      result = result.slice(0, opts.limit)
    }

    return result
  }

  async deleteRun(id: string): Promise<void> {
    await this.storage.deleteRun(id)
  }

  // ---- Utilities ----

  async checkDocker(): Promise<boolean> {
    return isDockerAvailable()
  }
}
