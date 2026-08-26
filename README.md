## Distributed Key-Value Store — Phases

### **Milestone A — Single-Node Storage Engine**

**Phase 1 — Basic KV Store**

- `SET`
- `GET`
- `DELETE`
- In-memory `Map`
- Concurrency basics

**Phase 2 — Persistence**

- Write-Ahead Log (WAL)
- Append-only log
- Crash recovery
- WAL replay

**Phase 3 — LSM Storage Engine**

- Memtable
- SSTables
- Sorted on-disk data
- Immutable SSTables
- Read path: Memtable → SSTables

**Phase 4 — Compaction**

- Why SSTables accumulate
- Merge SSTables
- Remove obsolete versions
- Tombstones
- Basic compaction
- Later: leveled vs size-tiered compaction

**Phase 5 — Fast Reads**

- SSTable indexes
- Sparse indexes
- Bloom filters
- Efficient key lookup

**Phase 6 — Storage Engine Optimization**

- Binary file format
- Checksums
- Compression
- WAL rotation
- Snapshots
- Recovery optimization

---

# **Milestone B — Make It Distributed**

This is where the project becomes a **Distributed KV Store**.

### **Phase 7 — Networking**

- TCP/HTTP/gRPC protocol
- Node-to-node communication
- Client → node requests
- Node identity
- Cluster configuration

```text
Client
  ↓
Node 1 ←→ Node 2
  ↕          ↕
Node 3 ←─────
```

---

### **Phase 8 — Partitioning / Sharding**

- Hash-based partitioning
- Consistent hashing
- Virtual nodes
- Key → partition mapping
- Data distribution
- Rebalancing when nodes join/leave
- Hot partitions

```text
key
 ↓
hash
 ↓
partition
 ↓
node
```

---

### **Phase 9 — Replication**

- Replicate each partition across multiple nodes
- Leader/follower model
- Replication factor
- Synchronous vs asynchronous replication
- Write quorum
- Read quorum
- Replication lag
- Replica failure

Example:

```text
Partition A

Leader
  │
  ├── Replica 1
  └── Replica 2
```

---

# **Milestone C — Consensus & Fault Tolerance**

This is where **Raft** comes in.

### **Phase 10 — Leader Election**

First understand:

- Why leader election is required
- Heartbeats
- Failure detection
- Terms/epochs
- Split brain
- Election timeout

Then implement a basic leader election mechanism.

---

### **Phase 11 — Raft Consensus Algorithm**

Implement **Raft**:

- Leader election
- Terms
- Candidate/Follower/Leader states
- RequestVote RPC
- AppendEntries RPC
- Log replication
- Commit index
- Applied index
- Majority/quorum
- Leader failure
- New leader election

```text
              Leader
             /      \
            ↓        ↓
         Node 2    Node 3
```

This is one of the **most important phases** of the entire project.

---

### **Phase 12 — Raft + KV Store**

Now connect Raft to our actual storage engine.

Instead of:

```text
Client
 ↓
SET x 10
 ↓
Local storage
```

we get:

```text
Client
 ↓
Leader
 ↓
Raft log
 ↓
Replicate
 ↓
Majority ACK
 ↓
Commit
 ↓
Apply to KV store
```

This is where it becomes a **real distributed KV store**.

---

# **Milestone D — Distributed Data Management**

### **Phase 13 — Consistency**

Study/implement:

- Strong consistency
- Eventual consistency
- Linearizability
- Sequential consistency
- Read-after-write consistency
- Quorum consistency

Understand:

> What does the client actually see when nodes fail?

---

### **Phase 14 — Failure Handling**

Simulate:

- Node crash
- Leader crash
- Replica crash
- Network delay
- Network partition
- Message loss
- Duplicate messages
- Node restart

Implement:

- Retries
- Timeouts
- Idempotency
- Recovery
- Replica catch-up

---

### **Phase 15 — Rebalancing**

When:

```text
Node 1
Node 2
Node 3
```

becomes:

```text
Node 1
Node 2
Node 3
Node 4
```

Move partitions appropriately.

Study:

- Consistent hashing
- Partition movement
- Replica movement
- Data migration
- Availability during rebalancing

---

# **Milestone E — Production-Level Features**

### **Phase 16 — Transactions / Atomic Operations**

- Compare-and-swap
- Atomic increment
- Batch operations
- Conditional writes
- Basic transactions

### **Phase 17 — TTL & Expiration**

- `SET key value EX 300`
- Expiration
- Background cleanup

### **Phase 18 — Observability**

- QPS
- P50/P95/P99 latency
- CPU
- Memory
- Disk I/O
- WAL size
- Compaction time
- Raft election count
- Replication lag

Use:

```text
Prometheus
Grafana
```

### **Phase 19 — Benchmarking**

Compare:

- Read throughput
- Write throughput
- Latency
- Single node vs distributed
- Replication overhead
- Compaction overhead

### **Phase 20 — Chaos / Failure Testing**

Automatically test:

```text
kill leader
↓
elect new leader
↓
continue writes
```

and:

```text
kill replica
↓
cluster continues
↓
replica returns
↓
replica catches up
```

---

# Final Architecture

By the end, you'll have roughly:

```text
                     Client
                       │
                       ▼
                 ┌───────────┐
                 │   Router  │
                 └─────┬─────┘
                       │
              Partition / Shard
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
    Partition A    Partition B    Partition C
        │              │              │
     ┌──┴──┐        ┌──┴──┐        ┌──┴──┐
     ▼     ▼        ▼     ▼        ▼     ▼
   Node   Node     Node   Node     Node   Node
    │      │        │      │        │      │
   Raft   Raft     Raft   Raft     Raft   Raft
    │      │        │      │        │      │
    ▼      ▼        ▼      ▼        ▼      ▼
  WAL   Storage    WAL   Storage   WAL   Storage
         Engine           Engine          Engine
           │                │               │
        Memtable          Memtable        Memtable
           │                │               │
        SSTables          SSTables        SSTables
           │                │               │
       Compaction        Compaction      Compaction
```

## The learning order

The **core journey** is:

```text
1. KV Store
      ↓
2. WAL
      ↓
3. Memtable + SSTable
      ↓
4. Compaction
      ↓
5. Index + Bloom Filter
      ↓
6. Networking
      ↓
7. Sharding / Consistent Hashing
      ↓
8. Replication
      ↓
9. Leader Election
      ↓
10. Raft
      ↓
11. Raft + KV Store
      ↓
12. Consistency
      ↓
13. Failure Handling
      ↓
14. Rebalancing
      ↓
15. Transactions / TTL
      ↓
16. Observability
      ↓
17. Benchmarking
      ↓
18. Chaos Testing
```

**The biggest milestones for you are:**

1. **LSM-based storage engine** — WAL + Memtable + SSTables + Compaction
2. **Distributed architecture** — Sharding + Replication + Consistent Hashing
3. **Consensus** — Raft + Leader Election + Fault Recovery
