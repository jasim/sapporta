# Principles

## Data integrity

Accept data exactly as received. Never coerce, transform, or silently fix incoming values. If the data is wrong, reject it — don't guess what the caller meant.

Validate strictly and fail loudly. The system must be trustworthy in how it handles data, and that means refusing invalid input rather than reshaping it into something that might be correct.
