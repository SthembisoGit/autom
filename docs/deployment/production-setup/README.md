# Personal Deployment Setup

Use this guide when you want `autoM` to run on a Windows host you control and
expose the backend through Tailscale Funnel.

This sequence assumes:

- a Windows laptop or desktop that stays powered on while you want automation
- the ops UI stays local on the host at `http://localhost:4173`
- Funnel exposes the backend callback URL over HTTPS
- Local Archive + YouTube as the launch scope
- Facebook deferred to a later version

## Setup Order

1. Prepare the host machine.
2. Expose the backend through Tailscale Funnel.
3. Create the Google Cloud YouTube project.
4. Start the app and connect YouTube.
5. Install the Windows auto-start task.
6. Verify publishing, scheduler behavior, and backup/restore.

## Documents

- [01 - Host Machine](01-oracle-vm.md)
- [02 - Tailscale Funnel](02-dns-and-tls.md)
- [03 - Google Cloud YouTube](03-google-cloud-youtube.md)
- [04 - Run the App](04-deploy-the-app.md)
- [06 - Auto Start](06-auto-start.md)
- [05 - Verify and Maintain](05-verify-and-maintain.md)

## If You Want The Short Version

Use [docs/deployment/oracle-free.md](../oracle-free.md) as the archive note
for the old Oracle path. Use the numbered docs above when you are setting up
the current Funnel-based personal deployment.
