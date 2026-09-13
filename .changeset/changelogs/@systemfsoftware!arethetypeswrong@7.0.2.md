## 7.0.2

### Patch Changes

- The CLI is now machine-first whenever stdout is not a terminal. A piped `attw` prints one compact JSON envelope instead of a table, failures print a typed JSON document on stderr and exit `1`, and `attw --quiet` reports only through its exit code. A terminal run still prints the tables it always did.

  Read `status` in the envelope to tell a typed package from an untyped one — exit code `0` covers both — and add `--include entrypoints,traces` only when you need the entrypoint graph or problem traces. `-f json` forces the envelope on a terminal, `-f table` forces a table on a pipe, and `attw schema` prints the JSON Schema of the input flags and of the envelope.

  The analysis engine now constrains the published `programInfo` schema to the shape it actually carries, and `InternalResolutionError` problems decode against the same shape the analysis emits — so consumers of its schemas no longer meet an unconstrained value or a shape mismatch.
