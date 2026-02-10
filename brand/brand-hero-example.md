# Hero Example — Before/After Contrast

## Concept

Left panel: Python. Right panel: rill.
Same agent behavior. The Python shows the defensive code that exists
because the language *allows* the failures. The rill shows what's left
when the language makes those failures structurally impossible.

---

## Python (left panel)

Caption: "Defensive code you write because the language allows it"

```python
async def classify_and_route(task: str) -> dict:
    # Call LLM — might throw, might return None
    try:
        response = await llm.classify(task)
    except Exception as e:
        return {"error": f"Classification failed: {e}"}

    # Response might be None, might be wrong type
    if response is None:
        return {"error": "No response from classifier"}

    if not isinstance(response.category, str):
        return {"error": f"Expected string, got {type(response.category)}"}

    # Route based on category
    handlers = {
        "billing": handle_billing,
        "technical": handle_technical,
        "general": handle_general,
    }

    handler = handlers.get(response.category, handle_general)

    try:
        result = await handler(task)
    except Exception as e:
        return {"error": f"Handler failed: {e}"}

    if result is None:
        return {"error": "Handler returned None"}

    return result
```

## rill (right panel)

Caption: "What's left when the failure modes are structurally impossible"

```rill
# No null. No exceptions. No wrong types. If it parses, it's safe to run.

$task
  -> host::classify
  -> .category:string
  -> [
    billing:   host::handle_billing,
    technical: host::handle_technical,
    general:   host::handle_general
  ] ?? host::handle_general
  -> $($task)
```

---

## Why this works

The Python is 25 lines. The rill is 7 (plus the comment).
But the point isn't brevity — it's *why* the Python is long.

Every defensive check in the Python maps to a failure category
that rill eliminates structurally:

| Python defensive code          | Why it doesn't exist in rill          |
|--------------------------------|---------------------------------------|
| `try/except` around LLM call  | No exceptions. Errors halt.           |
| `if response is None`         | No null. Functions always return.     |
| `isinstance()` type check     | `:string` asserts type inline or halts. |
| `try/except` around handler   | No exceptions. Errors halt.           |
| `if result is None`           | No null. Functions always return.     |

Five defensive checks. Zero in rill. Not because rill is less careful —
because the language made those failure modes structurally impossible.

---

## Annotations (optional, for landing page)

If the design supports it, the Python side could have subtle
markers on each defensive line that correspond to a legend below:

  🔴 try/except     → rill has no exceptions
  🔴 is None        → rill has no null
  🔴 isinstance()   → rill locks types at assignment

This makes the "structural" claim visual and concrete.

---

## Notes

- The Python is realistic, not a strawman. This is how careful
  developers actually write agent code.
- The rill uses real language features: dict dispatch, ??, host
  functions as values, piped invocation with $($task).
- `host::classify` etc. are host functions — the host controls
  what the agent can do. This subtly demonstrates the sandbox
  without naming it.
- The dispatch returns a handler function, then $($task) invokes
  it once — separating the routing decision from execution.
- The $task variable staying in scope across the pipe chain
  shows the dataflow model without explaining it.
- The ?? fallback to handle_general is a design choice, not
  defensive coding — it's the desired behavior, not a safety net.