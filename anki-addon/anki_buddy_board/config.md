**name** – how you show up on the board, e.g. `Jonathan`. Each person needs a different name (it becomes the file name `data/<name>.json`).

**repo** – the GitHub repo that hosts the board, as `owner/repo`, e.g. `jonathan/anki-buddies`.

**token** – a GitHub token that can write to that repo (fine-grained token, *Contents: Read and write*, limited to just that repo). It's stored in plain text in your Anki add-on folder, so don't use a token with wider access.

**branch** – the branch GitHub Pages serves from. Usually `main`.

After saving, use **Tools > Upload stats to Buddy Board** once to check it works.
