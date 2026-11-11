# The Seed: to-do list

## To check
- [ ] **Partner side** (steps 4–8 in HOW-TO-RUN.md): in a private window, request a second account, see "Waiting for approval," approve it under People, suggest an article as the partner, approve it as admin, and confirm the partner sees no Edit links or admin menu.
- [ ] **Recently rejected** on the Review page: "Move to library" (white) puts an article straight into the library, and "Delete" asks before deleting.
- [ ] The four internal or client items (Masterclass deck, two Sodexo toolkits, Google case study) are hidden from the library, which should show 21 articles.

- [ ] **Test staff vs. public access with a second email:**
  1. On **People**, add the second email to the **Public** list.
  2. Mark one article internal (tick **Internal** in Review or Edit) and approve it.
  3. In a private window, sign up with the second email and confirm it from the email link. It should be approved on its own and show as public.
  4. As that account, check that the internal article is missing from the library, from search, and from Ask answers.
  5. Optional: share an Ask answer that uses the internal article from your account; the public account shouldn't be able to open the link.
  6. Move the email to the **BITE staff** list. The internal article should now appear.

## Reminders
- [ ] **The Anthropic API key expires in January 2027.** Before then, make a new key at console.anthropic.com, paste it into `.env.local` (and into the hosting settings once the site is online), and restart the site. The research assistant and the scout stop working until the new key is in.

## To decide
- [ ] Whether the Food for Climate League Insights Repository should stay visible to partners.
- [ ] When to hand admin to your sister: approve her on People, then click **Make admin**.

## To review
- [ ] All summaries are AI-drafted and marked "Summary needs review." Read and edit each one.
- [ ] Confirm the years and author names flagged "Please confirm" in admin notes, such as Turnwald, Boles, and Crum 2017 and Camilleri et al. 2019.

## To build next
- [ ] **Put it online.** Right now The Seed runs only on this computer, so partners can't reach it yet. Next step: host it (for example, on Vercel) with the same Supabase keys.
- [ ] **Turn on the research assistant and scout** (built, not yet tried):
  1. In Supabase, open SQL Editor, paste all of `database/update-ai-features.sql`, and click Run.
  2. On the site, go to **Scout** and click **Load full text of the Drive files**.
  3. Try a question on the **Ask** page, then click **Run the scout**.
  4. Re-run `database/update-ai-features.sql` in Supabase (it now also adds the table for share links), then try **Share link** on an answer and open it in a private window with a second approved account.
- [ ] **Staff vs. public access (built, needs one SQL step):** in Supabase, paste all of `database/update-access.sql` and click Run. Then on **People**, add emails to the BITE staff list and the Public list. Mark internal articles with the "Internal" checkbox when editing or reviewing them (the four internal or client items above are good candidates). Test with a second account on the public list: it should not see internal articles in the library, in Ask, or in shared links. Also turn on "Confirm email" in Supabase (Authentication > Providers > Email) so a listed address can't be claimed by someone who doesn't own it.
- [ ] **Drive import, batch 1:** on **Scout**, click "Add the Drive articles to the review queue" (10 articles), then review them under Review. Afterward, decide whether to import the rest of the Drive folder (only about 4 in 10 shortcuts are readable; the rest need to be shared with the connected Google account).
- [ ] Check the source websites on the Sources page. About 20 obscure sources have no website yet.
- [ ] Make the scout run weekly on its own (after the site is online).
