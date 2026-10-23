# Review walkthrough

Status: recording not yet supplied. This document is a recording plan, not video evidence.

Use the installed Windows x64 package in the intended Codex desktop host. Use only synthetic conversations in a dedicated test workspace. Do not copy login credentials, record private chats, or include unrelated desktop content. The maintainer does not need to publish a reviewer account password: the plugin itself has no sign-in flow.

Suggested recording, about two minutes:

1. Show the SessionTree version in the plugin listing. Open a synthetic parent chat with two forks, one archived fork, and a separate unrelated chat.
2. In the conversation's right-hand pane, choose **New tab → More tools → Session Tree**. Show the current node and left-to-right branch arrows. Do not send a chat message to create this normal entry.
3. Search for a synthetic branch title, clear the search, pan and zoom, then use **Fit all** and **Locate**.
4. Collapse and expand a branch. Click an active node and show navigation to that conversation. Show that the archived node has a badge and does not navigate.
5. Switch to the unrelated chat and open its tree. Confirm the first chat's family is not reused.
6. If available in the test setup, create a fork and wait for the automatic update while preserving the view. If this cannot be shown, leave it out of the recording and report it as unverified.
7. Show a supported recovery path, such as reopening the panel after restarting the host connection.

The source preview can be rehearsed with:

~~~powershell
node scripts/preview-thread-panel.mjs
~~~

That fixture uses the production panel and synthetic host messages. A recording of it must be labelled as a fixture preview and does not prove the native entry or navigation.

Play back the actual recording to check readability, behavior, and absence of private data. Host it at a reviewer-accessible URL and verify playback before adding it as review.demo_recording_url. The official submission package remains incomplete until the required recording and other portal prerequisites are satisfied.
