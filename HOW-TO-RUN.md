# How to run The Seed

This takes about 15 minutes the first time. You only do steps 1–3 once.

## 1. Create the free database (Supabase)

1. Go to [supabase.com](https://supabase.com) and sign up (the free plan is plenty).
2. Click **New project**. Name it "The Seed," choose a database password (save it in your password manager; you won't need it day to day), and pick the region closest to you. Wait a minute or two while it sets up.

## 2. Load the library into it

1. In your new project, open **SQL Editor** in the left sidebar.
2. Open the file `database/setup.sql` from this folder in any text editor, select everything, and copy it.
3. Paste it into the SQL Editor and click **Run**. You should see "Success. No rows returned."

That one file creates the tables and the permission rules and loads the 102 sources, 53 topics, 20 library articles, and five items waiting for review. Running it again is harmless; nothing gets duplicated.

## 3. Two settings, then connect the site

1. **Turn off email confirmation** (so people can sign in right after requesting an account; your approval is the real gate): **Authentication → Sign In / Providers → Email**, switch off **Confirm email**, and save.
2. **Copy the two keys**: click **Connect** at the top of the project (or **Project Settings → API Keys**). You need the **Project URL** and the **publishable key** (it starts with `sb_publishable_`). Never use the "secret" key here.
3. Open the file `.env.local` in this folder and replace the two placeholder values:

   ```
   NEXT_PUBLIC_SUPABASE_URL=https://abcdefgh.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
   ```

## 4. Start the site

In Terminal:

```bash
cd ~/Code/BITE/the-seed && export PATH="$HOME/.local/node/bin:$PATH" && npm run dev
```

Then open <http://localhost:3000>. (Or just ask Claude to "start The Seed.") To stop it, press Control-C in Terminal.

## 5. Try it out (and check it works)

**Important:** the first person to request an account becomes the admin. Your sister should do this first.

1. **Admin sign-up.** Click "Request an account" and sign up. You should land straight in the library with **Review**, **Add**, **Sources**, **Topics**, and **People** in the menu.
2. **Browse.** You should see 20 articles. Try searching "defaults," "Willett," or "nudge," then filter by the topic "foodservice" or the source "World Resources Institute" (four articles).
3. **Review queue.** Open **Review**. Five items from the Drive folder are waiting. Edit one, then approve it; it should now appear in the library. Reject another; it moves to "Recently rejected."
4. **A partner.** In a private browser window, request a second account with a different email. You should see "Waiting for approval" and no articles.
5. **Approve them.** Back in the admin window, open **People** and click **Approve**. Refresh the partner's window: they can now browse.
6. **Suggest an article.** As the partner, use **Suggest an article** with any link and a note. It shows under "Your suggestions" as waiting, and it is *not* in the library yet. Try submitting the same link again; the site should warn you it's already waiting.
7. **Approve the suggestion** as the admin from **Review**. The partner should now find it in the library.
8. **Partners can't edit.** As the partner, there should be no Edit links and no admin menu items. Visiting `localhost:3000/admin/review` directly sends them back to the library.

## Automatic checks

There's also a set of 36 automatic checks of the database's permission rules and search. They run on your computer and don't touch Supabase:

```bash
cd ~/Code/BITE/the-seed && export PATH="$HOME/.local/node/bin:$PATH" && npm run test-db
```

It should end with "36 passed, 0 failed."

## If you change the starting data

The sources live in `database/sources.txt`, the original spreadsheet in `database/starter-articles.csv`, and the Drive items in `database/drive-folder-articles.json`. After editing any of them, run `npm run make-setup-sql` to rebuild `setup.sql`. Once the site is in use, though, it's easier to make changes through the admin pages.

## Before AI summaries go live

All summaries loaded so far are AI-drafted and marked "Summary needs review." A few years and author names were inferred from file names and are flagged "Please confirm" in the admin notes.
