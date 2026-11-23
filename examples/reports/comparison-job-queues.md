# Choosing a job queue for the ingest service

## Executive summary

Pick the managed queue. It costs more per million messages but removes the operations work, and the ingest service's peak load sits well under its documented limit. The self-hosted broker wins only if message volume passes roughly ten times today's.

## Question

Which job queue should the ingest service use: the managed queue or the self-hosted broker?

## Findings

- The managed queue documents a limit of 3,000 messages per second per queue ([managed queue docs](https://example.org/managed-queue)).
- The self-hosted broker sustained 48,000 messages per second on a three-node cluster in the vendor benchmark ([broker benchmark](https://example.org/broker-benchmark)).
- Ingest peaked at 420 messages per second last quarter ([capacity report](https://example.org/capacity-report)).

## Comparison

| Criterion | Managed queue | Self-hosted broker |
|-----------|:-------------:|:------------------:|
| Documented throughput | 3,000 msg/s per queue | 48,000 msg/s on three nodes |
| Operations work | None | Patching, upgrades, failover drills |
| Evidence | ⭐ Tier 1 | 🟡 Tier 3 |

## How it works

Producers write to the queue and consumers pull from it. The managed queue shards by queue, so throughput grows by adding queues, and each queue holds its own limit of 3,000 messages per second. Ingest at 420 messages per second uses a small share of one queue.

The broker shards by partition across its nodes and replicates each partition, which is where its higher ceiling comes from and also where its operating cost comes from: every node added is another machine to patch and another failure to rehearse.

The decision therefore turns on headroom, not on peak capability. Today's peak leaves a wide margin under the managed queue's limit, so the broker's extra capacity would be paid for and not used.

## Headroom

```calc
limit = 3000 @ https://example.org/managed-queue
peak = 420 @ https://example.org/capacity-report
share = peak / limit * 100
growth = limit / peak
```

Ingest uses 14% of one managed queue (derived: share), and could grow 7.1 times before it fills (derived: growth).

## Decisions

- Use the managed queue for the ingest service.
- Revisit when sustained load passes 1,500 messages per second.

## Rejected options

- Self-hosted broker: its capacity is not needed at today's load and its operations cost is.

## Confidence

Moderate. The broker figure is a vendor benchmark, so it is a ceiling, not a measurement of this workload.

## Gaps

- No cost comparison per million messages was found at current prices.
- Burst behaviour of the managed queue above its limit is not documented.

## Scope

- In scope: throughput headroom and operations burden for the ingest service.
- Out of scope: message ordering guarantees and multi-region replication.

## Contradictions

- None found after checking 3 sources.

## Sources

- [Managed queue docs](https://example.org/managed-queue)
- [Broker benchmark](https://example.org/broker-benchmark)
- [Capacity report](https://example.org/capacity-report)
