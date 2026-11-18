# Central Calendar

A calendar and time-blocking web app with Day, Week, Month and Year views. Plain HTML, CSS and ES modules: no build step and no dependencies.

## Run it locally

```bash
npm start          # or: node server.js        → http://localhost:5173
node server.js 5174   # another port
npm test           # unit tests: dates, repeats, layout, data model, .ics, Quick Add, sync merge
```

## Time blocking

- **Click an empty time** to add a block there. It starts on the 15-minute mark under the pointer, and the hover outline shows what you'll get.
- **Drag** to make a block of any length (snaps to 15 minutes), drag a block to move it, drag its top/bottom edge to resize.
- **Quick Add** (⚡ button or `Q`): type `Focus 4pm 15m`, `Standup 9:30-9:45am`, `Gym tomorrow 6pm 1h` or `Pay rent fri`, press Enter, type the next one. It stays open so you can plan a whole day.
- In the editor, the **Length** buttons (15m … 2h) set the end time in one click.
- Settings › Events: **Default Block Length** (15 min by default) and **Time Grid Interval** (5/10/15/30).

## Viewing vs editing

- Double-click (or Enter on) an event to open its **View** card: when it happens, how long, a live countdown ("Starts in 2 hr", "Happening now · ends in 10 min"), its **deadline** ("Due tomorrow at 5:00 PM · Due in 1 day 13 hr", red when overdue), location, repeat, alerts and the full details. **Edit** switches to the form; `⌘/Ctrl+E` goes straight to editing.
- **Deadline** is optional and separate from the block's time (work on it today, due Friday).
- **Mark Done** crosses an event out. For repeating events each occurrence is tracked separately.
- In Day view the right panel shows the View card for the selected event. Collapse it to a thin strip with › (or `\`); hide the calendar list with the sidebar button (or `[`).

## Sign in and sync

Sign in (top right) to keep the same calendar on your PC, Mac and phone. The app keeps working offline and syncs when it's back online.

- Your calendar is stored in this browser **and**, when signed in, in your own row in a Supabase (Postgres) database. Row Level Security means each account can only read and write its own calendar.
- Each event and calendar remembers when it last changed, and deletions are remembered for 90 days. When two devices both change things, the newest change to each item wins; nothing else is overwritten.
- Theme and Increase Contrast stay per device; other settings sync.
- Signing out keeps a copy on that device. Settings › Data still has .ics export/import and JSON backups.

Setup: put your project URL and publishable key in `src/config.js`. The database needs the `calendar_docs` table from `supabase/schema.sql`.

## Accessibility

- **Increase Contrast** (Settings › Appearance) darkens text, lines and labels; it also turns on automatically when your OS asks for more contrast.
- Light/dark/system themes, full keyboard support (`?` lists shortcuts), and a drawer layout that works on phones.

## Layout

```
index.html, icon.svg, server.js
src/config.js     Supabase URL + publishable key
src/lib/          pure logic (tested): dates, recurrence, layout, model, ics, quickadd, sync
src/app/          store (state, persistence, undo, change stamps), actions, cloud (auth + sync)
src/ui/           views, time grid, editor, event card, quick add, account, sidebar, header, settings…
supabase/         database schema and security rules
test/             node:test suites
```
