# @sapporta/ui — AI Instructions

## Error and Loading Philosophy

The UI must provide maximum visibility into what the system is doing. Loading states should say _what_ is being loaded, not just show a spinner. Error states should explain: what the UI was trying to do, what happened, and the exact error message from the server.

The UI must never interpret or rephrase backend errors — display them verbatim. If a backend error is unhelpful, the fix belongs in the backend (return a better error message), not in the UI (guessing what went wrong). The UI's job is to frame the error with its own context: which operation was attempted, which endpoint was called, what HTTP status came back.
