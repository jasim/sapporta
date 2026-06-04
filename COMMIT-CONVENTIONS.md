Observe Linux kernel commit conventions, plus:

Subject line —  within 75 chars. subsystem: prefix, imperative mood, lowercase after colon (unless proper noun), no trailing period.

Body —  two sections: Problem (current behavior, why wrong: user-visible symptoms; paste logs verbatim, or what needs to be improved, why, its value etc) and Solution (approach taken, why over alternatives, side effects/impacts). Do not add labels like "Problem:" or "Solution:".

You MUST keep the commit message body length to within 75 letters and MUST use explicit line breaks to hard wrap lines.
You can skip hard line wrapping for things like quoted output (errors, panics), long URLs, or trailer lines.

eg:
```
subsystem: imperative statement of the change

Describe the problem. Current behavior, why it is flawed,
user-visible symptoms or errors. Paste logs here (do not wrap
long log lines).

Explain the solution. Why this approach over alternatives. Note
side effects or constraints.
```
