# 🃏 Anki Buddies

A small website where you and your mates compare Anki reviews: who did more
today, this week, this month, study time, new cards, retention, streaks, a
year-long heatmap and when each of you studies.

```
 your Anki ──┐                                 ┌──> https://<you>.github.io/anki-buddies
             ├─ add-on uploads data/<name>.json ┤
 mate's Anki ┘        (GitHub repo)            └──> same page, everyone's stats
```

**Live site:** https://brotmeisterorig.github.io/anki-buddies/

**Why there's no "log in with Anki" button:** AnkiWeb has no public API and
won't let other websites log in on your behalf. Instead, a small Anki add-on
reads your review history on your own computer and uploads the numbers to this
repo. Nothing else leaves your computer: no card contents and no deck names,
only counts and times per day.

Uploads happen automatically when you sync with AnkiWeb, when you leave the
review screen, and when you close Anki. It only uploads when something has
changed.

---

## 1. Put the site on GitHub (once, by one person)

1. Create a **public** repo on GitHub, e.g. `anki-buddies`, and push these files to it.
2. In the repo, go to **Settings → Pages**, set *Source* to **Deploy from a branch**,
   choose **main** and **/ (root)**, and save.
3. After a minute the site is live at `https://<your-username>.github.io/anki-buddies/`.
   Add `?demo` to the end of that address to see it with fake data.

## 2. Make a token that can upload stats

The add-on needs permission to write files to the repo.

1. GitHub → your avatar → **Settings → Developer settings → Personal access tokens →
   Fine-grained tokens → Generate new token**.
2. **Repository access:** *Only select repositories* → pick `anki-buddies`.
3. **Permissions → Repository permissions → Contents:** *Read and write*.
4. Set an expiry date you're happy with (you'll need a new token when it runs out), then generate it and copy it.

**For your mate:** the easiest way is to share this same token with them
privately. It can only touch this one repo. If you'd rather they don't use
yours, add them under **Settings → Collaborators**. They can then make their own
*classic* token with the `public_repo` scope. Fine-grained tokens can't
target a repo someone else owns.

## 3. Install the add-on (everyone)

Either:

- run `./build-addon.sh`, then double-click the `anki_buddy_board.ankiaddon` it creates, **or**
- in Anki: **Tools → Add-ons → View Files**, then copy the `anki-addon/anki_buddy_board`
  folder into the folder that opens.

Restart Anki, then **Tools → Add-ons → Anki Buddy Board → Config** and fill in:

```json
{
    "name": "Jonathan",
    "repo": "brotMeisterOrig/anki-buddies",
    "token": "github_pat_...",
    "branch": "main"
}
```

Each person needs a **different name**. Then use **Tools → Upload stats to Buddy Board**
once. You should see "Stats uploaded" and a new file in the repo's `data/` folder.
The site picks it up within a minute or two.

---

## What's on the board

| | |
|---|---|
| **Standings** | Reviews, time studied, new cards, retention (share of review cards you didn't press *Again* on), current and best streak, and a warning if you haven't reviewed today |
| **Banner** | Who's leading and roughly how much reviewing closes the gap |
| **Progress** | Reviews, minutes or new cards over time. Switch between today, 7 days, 30 days, year or all time |
| **Heatmap** | 12 months of daily activity, on the same colour scale for everyone so the comparison is fair |
| **Collections** | Mature, young, learning and unseen cards for each person |
| **When you study** | Which hours of the day each of you reviews in |

Days follow Anki's own day boundary (4am by default), so late-night sessions count for the day before.

## Files

- `index.html`, `style.css`, `app.js`: the website (plain static files, no build step)
- `config.js`: optional settings (custom domain, fallback player list)
- `data/`: one JSON file per person, written by the add-on
- `anki-addon/anki_buddy_board/`: the Anki add-on
- `build-addon.sh`: packs the add-on into a `.ankiaddon` file

## Troubleshooting

- **"GitHub rejected the token"**: it expired or was mistyped. Make a new one (step 2).
- **"repo doesn't exist or the token can't write to it"**: check `repo` is exactly `owner/name`
  and that the token has *Contents: Read and write* on that repo.
- **The site doesn't show my latest reviews**: GitHub Pages takes about a minute to update after an upload,
  and the page refreshes itself every 5 minutes.
- **Using a custom domain**: set `repo: "owner/anki-buddies"` in `config.js` so the site can find the data.
