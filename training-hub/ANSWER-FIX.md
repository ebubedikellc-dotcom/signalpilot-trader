# Question response repair

On 1 November 2026, the live control panel accepted one hypothetical recovery
question and then returned `Qwen request timed out or could not connect` after
the five-minute observation. No model answer was verified. The shared message
did not identify which of those two causes occurred.

The preceding question transport allowed 700 output tokens with a 300-second
socket timeout; previous server logs showed roughly 1.2 generated tokens per
second. This mismatch can time out a valid response on that CPU. The old UI
also displayed the same waiting message while generating and did not expose
its request ID.

This repair changes only the web image. It requests concise answers with a
384-token ceiling, permits a 900-second model network timeout, retains the
existing model, context size and shared model gate, and consumes streamed
responses to expose waiting/preparing/writing phases. Only a nonempty, complete
response becomes an answer. Truncated or interrupted output remains an error.
The page shows the request ID and can resume the most recent request after a
reload or in a new browser. Requests/results remain process-local; a web
restart loses them. A generation may still need to wait behind an active
lesson (existing gate maximum: 35 minutes).

The installer reads the running web files, preserves other routes/forms and
reuses all running Compose configuration files. It changes only the web image
and restarts only the web container. The deployment creates a rollback image,
runs isolated tests without a network or production data, and checks the new
endpoint and form. A failed startup restores the old web image. It does not
retry lessons, change the model, or restart video/PDF/model services.

Run `deploy_answer_fix.sh FULL_COMMIT_SHA` from the existing VPS project.
In later Compose commands, include `-f compose.answer-fix.yaml` last.
Wait for a pending question to finish before installing: recreating the web
service interrupts any question it is currently handling.

Validation: `python -m unittest -v test_answer_fix`, `node --check question_ui.js`
and `bash -n deploy_answer_fix.sh`. Tests use stub model responses. They do not
prove a successful answer from the live Qwen service. After installation, ask
one question through the panel and check the actual returned answer and source.

Prepared test from Advanced 03, section 4: a hypothetical balance drops from
1,000 to 750. The loss is 25%, but recovery requires 250/750 = 33.333...%, since
the recovery calculation uses the smaller remaining balance. No answer was
supplied to Trade Lord during the live test.
