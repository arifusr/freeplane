// Base abstract class for Graph Storage Adapters
export class GraphStorageAdapter {
  constructor(options = {}) {
    this.options = options;
  }

  async init() {
    throw new Error('init() must be implemented');
  }

  async close() {
    throw new Error('close() must be implemented');
  }

  // Maps management
  async createMap(map) {
    throw new Error('createMap() must be implemented');
  }

  async getMap(mapId) {
    throw new Error('getMap() must be implemented');
  }

  async listMaps() {
    throw new Error('listMaps() must be implemented');
  }

  async deleteMap(mapId) {
    throw new Error('deleteMap() must be implemented');
  }

  // Node operations
  async addNode(node) {
    throw new Error('addNode() must be implemented');
  }

  async getNode(nodeId) {
    throw new Error('getNode() must be implemented');
  }

  async updateNode(nodeId, updates) {
    throw new Error('updateNode() must be implemented');
  }

  async deleteNode(nodeId) {
    throw new Error('deleteNode() must be implemented');
  }

  // Edge operations
  async addEdge(edge) {
    throw new Error('addEdge() must be implemented');
  }

  async deleteEdge(edgeId) {
    throw new Error('deleteEdge() must be implemented');
  }

  // Graph Traversal & Queries
  async getSubtree(rootNodeId) {
    throw new Error('getSubtree() must be implemented');
  }

  async getNeighborhood(nodeId, hops = 2) {
    throw new Error('getNeighborhood() must be implemented');
  }

  async findPath(sourceId, targetId, maxHops = 10) {
    throw new Error('findPath() must be implemented');
  }

  async search(query, mapId = null) {
    throw new Error('search() must be implemented');
  }

  async query(queryString, params = {}) {
    throw new Error('query() must be implemented');
  }

  // Penanda perubahan antar-koneksi (SQLite: PRAGMA data_version).
  // Dipakai TUI untuk mendeteksi perubahan dari proses CLI lain.
  getDataVersion() {
    return 0;
  }
}
