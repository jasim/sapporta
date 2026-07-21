# Coding principles

## Reuse or replace existing domain logic; never create a parallel version

Before adding a type, schema, validator, transformation, query, policy, or helper, search for the existing implementation of that knowledge.

If it exists, reuse it, extend it, move it, or replace it and migrate its callers. Do not create a nearby equivalent because the existing code has a different name, shape, or location. Two implementations of the same decision are duplicates even when their code looks different.

Boundary representations may differ. An API schema, domain type, database record, and UI model can have different shapes. They must still derive their meaning from the same domain rules. Adapters translate representations; they do not redefine validation, normalization, calculation, workflow, or policy.

Deduplicate knowledge, not appearance. Similar code may remain separate when it represents rules that can change independently. Unify implementations when a change to the underlying rule must apply to all of them.

## Parse at trust boundaries, pass typed values forward, and keep I/O at the edges

Structure each event path as:

```text
input → parsed domain values → decisions → optional effect plan → I/O
```

Parse at every trust boundary. After parsing, pass values whose types record the facts already established.

Do not depend on ambient mutation, call order, repeated validation, or reconstructed context. Keep domain decisions deterministic. Perform database, network, filesystem, and UI effects at the boundary.

## Keep each domain concept and its rules in one coherent module

A domain concept should own its types, construction, parsing, rules, queries, and transformations.

Orchestration should show the meaningful transitions from trigger to outcome. The implementation of each transition should remain with the concept it governs, not in generic procedural buckets such as `helpers`, `services`, or `utils`.

## Add a type or layer only when it removes more reasoning than it adds

Every type, function, stage, adapter, plan, and module adds vocabulary. Introduce one only when it:

- establishes a new guarantee;
- gives a domain rule an authoritative home;
- preserves information that would otherwise be lost; or
- hides a changeable decision behind a simpler interface.

Prefer modules whose interfaces are materially simpler than their implementations. Depth is compression, not size.

Pass-through wrappers, mirrored parameter lists, and chains of single-use helpers usually fragment the path without simplifying it. Fold them into the concept they serve.

## Keep related data together until its meaning or lifecycle diverges

Preserve a complete value at its origin. Project smaller, consumer-specific views where they are consumed.

Split data when its construction, lifecycle, audience, phase, or rate of change differs. Represent distinct phases explicitly, often with discriminated unions. Avoid casts, placeholder values, and correlated optional fields. Recombine values only at a real integration boundary.

## Use typed plans for complex effects and direct calls for simple ones

Return a typed, inspectable effect plan when execution involves alternative effects, ordering, retries, partial failure, auditing, preview, or multiple executors.

Execute the plan mechanically at the effect boundary. Keep straightforward operations direct.

## Judge the design by how easily an event can be traced end to end

An engineer should be able to follow an event from input to outcome without recovering discarded context or simulating hidden state.

The goal is neither more types nor fewer layers. The goal is a code path whose boundaries match the domain and whose decisions have one visible source.