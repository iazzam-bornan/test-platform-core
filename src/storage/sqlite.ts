import { Database } from "bun:sqlite"
import type { Storage, RunState, RunStatus } from "../types"
import fs from "fs"
import path from "path"

export class SqliteStorage implements Storage {
  private db: Database

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

    this.db = new Database(dbPath)
    this.db.exec("PRAGMA journal_mode=WAL;")
    this.migrate()
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
      CREATE INDEX IF NOT EXISTS idx_runs_started ON runs(started_at);
    `)
  }

  async saveRun(state: RunState): Promise<void> {
    this.db.prepare(`
      INSERT OR REPLACE INTO runs (id, state, status, started_at, finished_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      state.id,
      JSON.stringify(state),
      state.status,
      state.startedAt,
      state.finishedAt ?? null
    )
  }

  async getRun(id: string): Promise<RunState | null> {
    const row = this.db.prepare("SELECT state FROM runs WHERE id = ?").get(id) as
      | { state: string }
      | undefined
    if (!row) return null
    return JSON.parse(row.state)
  }

  async listRuns(opts?: { status?: RunStatus; limit?: number }): Promise<RunState[]> {
    let sql = "SELECT state FROM runs"
    const params: unknown[] = []

    if (opts?.status) {
      sql += " WHERE status = ?"
      params.push(opts.status)
    }

    sql += " ORDER BY started_at DESC"

    if (opts?.limit) {
      sql += " LIMIT ?"
      params.push(opts.limit)
    }

    const rows = this.db.prepare(sql).all(...params as []) as { state: string }[]
    return rows.map((r) => JSON.parse(r.state))
  }

  async updateRun(id: string, patch: Partial<RunState>): Promise<void> {
    const existing = await this.getRun(id)
    if (!existing) return
    const updated = { ...existing, ...patch }
    await this.saveRun(updated)
  }

  async deleteRun(id: string): Promise<void> {
    this.db.prepare("DELETE FROM runs WHERE id = ?").run(id)
  }
}
