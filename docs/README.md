# Safe Eats — Project Documentation

Start with **[40-mvp-plan.md](40-mvp-plan.md)**. It is the active plan and it supersedes the v1.0 schedule.

## Reading order

| # | Document | Answers | Status |
|---|---|---|---|
| 05 | [v1 Audit Findings](05-v1-audit-findings.md) | What was actually broken, with evidence | Complete |
| 10 | [Project Charter](10-project-charter.md) | Why this exists, who decides, what success is | C2 amended by DEC-003 |
| 11 | [Discovery Brief](11-discovery-brief.md) | Who it is for, what else exists | Complete |
| 12 | [PRD v1.0](12-PRD-v1.0.md) | What must be true — 68 requirements | Requirements contract; MVP selects a subset |
| 13 | [Traceability Matrix](13-traceability-matrix.md) | Requirement ↔ objective ↔ verification | Complete |
| 14 | [Decision Log](14-decision-log.md) | What was decided and what would reverse it | Living |
| 20 | [Execution Plan](20-execution-plan.md) | Critical path analysis of the full scope | Superseded by 40 |
| 30 | [Product Backlog](30-product-backlog.md) | 47 stories against the full scope | Reference; MVP tasks are in 40 |
| 40 | **[MVP Plan](40-mvp-plan.md)** | **What gets built, in what order, by when** | **Active** |

## How they fit together

**05** measures what v1 got wrong. **10–13** define the product and its requirements. **20** and **30** decompose the full v1.0 scope — 150 hours over 12–15 weeks. **40** cuts that to 38 hours over 4 weeks, because the audit removed the scraping subsystem and resolved the geocoding unknown; **14** records why.

Requirement IDs (`FR-xxx`) are stable across all documents. The MVP plan cites them on every task so the trace from charter to commit survives the descope.

## Not written, deliberately

`21-dependency-register.md`, `23-interface-contracts.md`, and `24-status-and-governance.md` are referenced by the v1.0 set but do not exist. That is a decision, not an omission — see **DEC-004**. They coordinate work between people; this is a solo project.
