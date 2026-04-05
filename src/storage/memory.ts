import type { Storage, RunState, RunStatus } from "../types"

export class MemoryStorage implements Storage {
  private runs = new Map<string, RunState>()

  async saveRun(state: RunState): Promise<void> {
    this.runs.set(state.id, structuredClone(state))
  }

  async getRun(id: string): Promise<RunState | null> {
    const run = this.runs.get(id)
    return run ? structuredClone(run) : null
  }

  async listRuns(opts?: { status?: RunStatus; limit?: number }): Promise<RunState[]> {
    let runs = [...this.runs.values()]

    if (opts?.status) {
      runs = runs.filter((r) => r.status === opts.status)
    }

    runs.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())

    if (opts?.limit) {
      runs = runs.slice(0, opts.limit)
    }

    return runs.map((r) => structuredClone(r))
  }

  async updateRun(id: string, patch: Partial<RunState>): Promise<void> {
    const run = this.runs.get(id)
    if (run) {
      Object.assign(run, patch)
    }
  }

  async deleteRun(id: string): Promise<void> {
    this.runs.delete(id)
  }
}
