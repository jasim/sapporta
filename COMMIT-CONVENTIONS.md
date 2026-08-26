Observe Linux kernel commit conventions, plus:

Subject line — within 75 chars. subsystem: prefix, imperative mood, lowercase after colon (unless proper noun), no trailing period.

Body — two sections: Problem (current behavior, why wrong: user-visible symptoms; paste logs verbatim, or what needs to be improved, why, its value etc) and Solution (approach taken, why over alternatives, side effects/impacts). Do not add labels like "Problem:" or "Solution:".

Each line in commit message should be maximum 75 letters in length. However hard line wrapping should be avoided for quoted output (errors, panics), long URLs, or trailer lines.

eg:

```
subsystem: imperative statement of the change

Describe the problem. Current behavior, why it is flawed,
user-visible symptoms or errors. Paste logs here (do not wrap
long log lines).

Explain the solution. Why this approach over alternatives. Note
side effects or constraints.
```

Do not be verbose - both in the meaning/semantics and in language. A commit
message should say why the changes were made and what they are. But it should
not explain the diff in great detail . Lead with the highest-level decisions
and changes; do not describe the changes unless they have a specific reason
that is not apparent from the code.