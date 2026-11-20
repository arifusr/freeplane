import { SQLiteGraphAdapter } from './sqlite-graph-adapter.mjs';
import { LadybugAdapter } from './ladybug-adapter.mjs';

export async function createGraphStorage({ type = 'auto', dbPath = null } = {}) {
  // If explicitly requested LadybugDB
  if (type === 'ladybug') {
    const adapter = new LadybugAdapter({ dbPath: dbPath || './mindmaps.lbug' });
    await adapter.init();
    return adapter;
  }

  // Auto mode: LadybugDB-first with graceful fallback to embedded SQLite Graph engine
  if (type === 'auto') {
    try {
      const adapter = new LadybugAdapter({ dbPath: dbPath || './mindmaps.lbug' });
      await adapter.init();
      return adapter;
    } catch {
      // Gracefully fall back to embedded SQLite graph engine
      const adapter = new SQLiteGraphAdapter({ dbPath: dbPath || './mindmaps.db' });
      await adapter.init();
      return adapter;
    }
  }

  if (type === 'sqlite') {
    const adapter = new SQLiteGraphAdapter({ dbPath: dbPath || './mindmaps.db' });
    await adapter.init();
    return adapter;
  }

  throw new Error(`Unknown storage type: ${type}`);
}
