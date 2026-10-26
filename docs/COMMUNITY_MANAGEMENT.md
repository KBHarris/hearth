# Delete channels, categories and communities

Open the gear beside your community name. Only the community owner sees the
deletion controls; the server checks ownership again for every request.

- **Channels:** choose Channels, then Delete beside a channel.
- **Categories:** choose Categories, then Delete beside a category. Its channels
  are kept and moved out of that category.
- **Community:** choose Delete community at the bottom of community settings.
  This removes access to the community and all its channels.

Type the item's exact name to confirm. Cancel or Escape returns to settings and
preserves unfinished creation forms. A connection failure keeps the confirmation
and typed name so it can be retried.

Deleting a channel or community stops new messages and calls. Other devices
discover the change through their existing room checks and directory refresh.
An unsent message is kept in its current view; it is never automatically sent to
another channel. Choosing a different conversation explicitly clears that draft,
as it did before this change.

Deletion does not erase saved messages, encrypted files, device copies or backups.
The server retains channel identifiers to ensure a deleted channel can never be
treated as a direct conversation. This is removal of access, not content erasure.
Existing retention and account/file erasure policies remain separate operations.
A deleted community no longer counts as an owned community when its former
owner requests account deletion; active community ownership must still be
transferred first. Deleted communities also reject policy changes.

Both client and server need the deletion update. The focused check
`node scripts/verify-community-deletion-ui.mjs` uses disposable local PostgreSQL
and Chromium, with the real UI, authentication and MLS engine. It never operates
on the installed user's community or profile. The three ignored server tests in
`community::deletion::tests` require an isolated PostgreSQL database through
`DATABASE_URL`; they cover ownership, scoped confirmation, retained identifiers,
invites/voice access and an access check waiting behind a concurrent deletion.
