# FastForward

## UI demo

Open [`ui/index.html`](ui/index.html) in a browser. The page uses plain HTML, CSS, and JavaScript and runs without a build or backend.

1. Open any pipeline stage. Use the stage strip to move between views and **Results** to inspect the candidates evaluated at the current stage.
2. Drag the divider to resize the source and detail panes. With the divider focused, use the arrow keys to adjust it. On small screens the panes stack.
3. Approve a recommended change and choose **Generate optimised code** in the approval queue. Final shows the build selection, combined diff, and demo verification.
4. To try a failed build, approve both **Use the built-in list count** and **Count a list of matches**, then generate again. Final identifies the overlapping patches. Reject either change and rebuild to recover.

Timing and correctness figures are illustrative. Decisions persist for the browser tab's session. Final build results last until reload.
