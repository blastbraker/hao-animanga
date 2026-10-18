# HAO beta tester verification

Run this checklist with a separate invited account before increasing the beta group. Never promote the account to administrator.

## Account and permissions

- Open the invitation in the same browser that will use HAO and finish sign-in.
- Confirm the profile menu shows the tester's email name.
- Confirm there is no **Admin** navigation item and `/admin` displays the access-required screen.
- Confirm another tester's library, favorites, notes, and progress are not visible.
- Change the profile maturity ceiling, refresh Home and Discover, and confirm titles above the ceiling are hidden.
- Read on one device, open the same title on another device, and confirm the latest chapter/page and reader controls resume.
- Export a full HAO backup in Settings and restore it to the same beta account.

## Managed sources

- On Home, confirm **Beta Bridge online** appears with approved sources.
- Confirm the tester is not asked to install HAO Bridge or add a repository.
- Open **Beta guide** and confirm it explains Discover, Watch, Read, and source responsibility.
- Open Settings and confirm the managed Bridge is visible but repository-management controls remain tied to a personal Bridge.

## Core journeys

- Save one AniList title to the library, reload, and confirm it remains saved.
- Play the signed fixture anime, confirm autoplay begins, seek, reload, and confirm resume works.
- While playing, switch to another browser tab and return; repeat after a sign-in/token refresh. Confirm the same video, source, episode, audio choice, and timestamp remain in place without repeating source searches. Sign-out, switching accounts, or an explicit access denial must still close the protected player.
- Delay cloud progress saves, then change quality, server, and episode. Playback should switch without waiting for the cloud request, preserve position for the same episode, and eventually save the newest progress. A sub-only fallback must not extract the same server's streams twice. Source fallback may prepare one alternative's metadata while checking the preferred source, but must retain preference order and stop unused lookups after a playable match.
- During an authorized HLS fixture, check recovery from a brief network interruption without restarting the episode. Verify memory remains bounded on a long viewing session; hls.js retains a limited back buffer, while native Safari manages its own buffer. Returning from a hidden tab or resuming a paused player must not immediately trigger a quality-upgrade retry.
- Check **Up next** at a known AniSkip ending (or the last 15 seconds without timing). Confirm pause/buffering freezes the countdown, seeking backward hides it, **Play now** advances once, and **Not now** prevents auto-next for that episode without changing the saved preference. With autoplay off, it must wait for a click; the last episode must show no popup. Check mobile, desktop, and container fullscreen. When container fullscreen is unavailable, HAO uses a full-window player so the popup and custom controls remain visible. Verify its exit button/Escape, orientation changes, scroll restoration, and that changing episodes/quality keeps the expanded player open. Safari's address bar may remain visible outside an installed PWA.
- With fixture catalog responses, make the English title search return no match and the metadata's Japanese title return the correct season. Verify both the title page and player find it, reject a different season/movie, and preserve the episode number during source fallback. Alias search is bounded to four distinct names per source and stops on a confident match.
- Browse MangaDex, open a chapter, switch among Webtoon, Left to right, and Right to left, then reload and confirm the mode persists.
- Temporarily stop the shared Bridge and confirm Home, Player, and Reader show a useful offline message with Retry or Source status actions.
- Save one manga chapter offline, stop the Bridge, reload that chapter, and confirm every cached page remains readable.
- Upload and open a test EPUB once, disconnect the device, then reopen it from the Novels shelf.

## Pass criteria

The tester can discover, save, watch the licensed fixture, read an authorized chapter, resume progress, and recover from a provider failure without administrator access or another user's data. Record the date, tester email, browser, device, and any failure before inviting the next group.
