Observe Linux kernel commit conventions, plus:

Subject line —  within 75 chars. subsystem: prefix, imperative mood, lowercase after colon (unless proper noun), no trailing period.

Body —  two sections: Problem (current behavior, why wrong: user-visible symptoms; paste logs verbatim, or what needs to be improved, why, its value etc) and Solution (approach taken, why over alternatives, side effects/impacts). Wrap at 72 cols. Do not add labels like "Problem:" or "Solution:".

Do not wrap —  quoted output (errors, panics), long URLs, trailer lines.

eg:
```
subsystem: imperative statement of the change

Describe the problem. Current behavior, why it is flawed,
user-visible symptoms or errors. Paste logs here (do not wrap
long log lines).

Explain the solution. Why this approach over alternatives. Note
side effects or constraints.
```