# 05 - Verify And Maintain

This step confirms the personal Funnel deployment works and tells you how to
keep it healthy.

## End-To-End Verification

1. Generate one approved job.
2. Publish it to YouTube.
3. Confirm the video appears on the channel.
4. Confirm the Local Archive copy is written.
5. Confirm the run history records the YouTube result.

## Scheduler Verification

1. Trigger one scheduler tick manually with `npm run scheduler:tick:dev`.
2. Confirm the scheduler queues the right profile.
3. Confirm the next automatic tick also works while the host stays awake.

## Backup Procedure

Back up these paths regularly:

- `C:\autoM\var\db\autom.sqlite`
- `C:\autoM\var\output`
- `C:\autoM\var\published`

## Restore Procedure

1. Stop the server and ops UI.
2. Restore the SQLite file.
3. Restore the media directories.
4. Restart the server and ops UI.
5. Confirm the dashboard and history pages still load.

## Operational Notes

- Keep the host awake while you expect automation to run.
- Use the local ops UI on the host machine.
- The Funnel URL is the public callback only.
- If the machine sleeps or powers off, publishing pauses until it is back on.
- Keep Facebook deferred until the Meta app setup is ready.

## When To Call It Ready

Treat the personal deployment as ready when:

- YouTube connect works against the Funnel callback
- one real upload succeeds
- the Local Archive copy is written
- the scheduler tick runs successfully on the host
- a backup/restore rehearsal succeeds
