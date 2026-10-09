# Safeguarding: an outline procedure for whoever runs ZimTutor

> **Status.** This is an outline for the operator to adopt, adapt and train on, with their own legal
> and child-protection advice. It is not a finished policy, not legal advice, and it names no
> authority, number or duty that the operator has not confirmed for the country they run in. The
> product's technical behaviour, described in section 1, is what the code does today and is tested.

ZimTutor is used by primary-school children. It is built so that a child cannot be contacted through it
and cannot contact anyone: there is no chat between people, no profile, no photograph, no location
and no advertising. What remains is the one thing a child can type: a question to the tutor. This
document is about what to do when that text shows something a person needs to know.

## 1. What the product does

1. **What a child types as a question to the tutor is screened first**, by plain deterministic rules
   (`src/lib/ai/safety.ts`, `src/lib/ai/patterns.ts`), before any model or any storage. What a child
   types into an _answer_ box has personal details removed before it is kept or shown, but is not
   read for worrying content (see section 5).
2. **Personal details are never forwarded and never kept.** A phone number, an address, an email
   address, a link, an ID number, a password or a social-media handle is replaced by `[removed]` in the
   stored message and the child is told, kindly, to keep private things private.
3. **Worrying messages get a warm, fixed reply.** Words that suggest harm, abuse, fear, bullying or
   hunger are answered with a short, fixed message that points to a grown-up the child trusts and
   names a child helpline (`CHILD_HELPLINE_NAME` / `CHILD_HELPLINE_NUMBER`). The lesson then carries on
   where it was. No model writes this reply.
4. **Messages in either category are stored _flagged_** so a person can read them. They are the only
   private-conversation rows an administrator can read: the database refuses an administrator any
   other message, and parents cannot read any conversation at all (they see what a child worked on and
   how it went, not what was said).
5. **Other things get short fixed replies**: moving to another app, trying to change the tutor's
   rules, unkind words. These are not flagged.
6. **Every review is recorded.** An administrator's decision on a flagged message is saved with who
   made it and when, and written to the audit log (`/admin/audit`) _without the child's words_.
7. **A parent can delete a child's account** (their page → "Delete … account") and everything saved
   about the child goes with it. The audit entry that a message was reviewed (the message's id, the
   outcome, who decided) stays, naming no child and holding no text. A reviewer's note is kept in that
   entry too; see section 3 for what to put in it.

## 2. Roles

| Role                                   | Does                                                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **Designated safeguarding lead (DSL)** | Owns this procedure; reads flagged messages; decides what happens next; keeps the incident record.     |
| **Deputy**                             | Covers the DSL's absence. Trained to the same standard. There must always be one of the two reachable. |
| **Administrators**                     | Anyone with the `admin` role can open `/admin/safety`. Keep this to the DSL and deputy.                |
| **Operator (the organisation)**        | Chooses and trains the above, confirms the helpline number, handles reports to the authorities.        |

Make an administrator with `npm run admin:promote` (it needs database access, so it is a deliberate
act). Remove access when someone leaves by changing their role in the database. Everyone with access
should be vetted and agree in writing to keep what they read confidential.

## 3. The routine

1. **Look at `/admin/safety` on a fixed schedule** (the operator decides how often; at least every
   working day while children are using the service, and a named person covers holidays). The home page
   of the administration area shows how many flagged messages are waiting.
2. **Read each message** with its category ("Sounded worrying" or "Shared personal details"), the
   learner's first name or nickname and the lesson goal it came from. You see the flagged message as it
   was kept; you do not see the rest of the conversation. That is deliberate, and it is a limit: if the
   message is worrying, you may need to decide with only those words.
3. **Decide and record:** _No concern: nothing needs doing_ or _Followed up under our safeguarding
   procedure_. Add a short note of what you did or why not.
   - Put **facts and actions** in the note ("passed to the DSL, parent contacted 14:30"), **not** the
     child's name, contact details, or a copy of what they wrote. The note is stored with the audit
     record and survives the deletion of the child's account.
4. **Re-reviewing is allowed** (a later fact changes the decision); both decisions stay in the audit log.

## 4. What to do, by kind of message

> The steps below are an outline. The right action depends on the law and the services that exist
> where you operate. Settle them, with the names and numbers, before launch, and write them in here.

### Sounded worrying (`WELLBEING`)

Treat as a possible child-protection concern until you have read it and decided otherwise.

1. **Is a child in immediate danger?** If it reads that way, do not wait for the routine: contact the
   emergency and child-protection services you have agreed in advance. _(Write them here:
   ______________________.)_
2. **Read it for what it says, not what words it contains.** The screen matches words; a child writing
   "my teacher was hungry for a fraction" is not in danger, and a child in danger may use no matched
   word at all. When unsure, ask the deputy.
3. **Decide who to tell.** The usual route is the parent who holds the account. If the worry is about
   someone in the household, telling the parent may make things worse: follow the child-protection
   guidance for that case, and take advice from the child helpline or the agency you have agreed to
   consult. _(Write the agencies and the reporting duties here: ______________________.)_
4. **Record what you did** in the review note, and in the operator's own incident record (section 6).
5. **Follow up**: did the right person act? Put a date to check.

### Shared personal details (`PERSONAL_INFO`)

The details were removed before they were stored, so there is usually nothing to do but record it. Look
for a pattern: the same child sharing repeatedly, or a message that suggests someone asked them to
share ("my friend said I must put my number"). That second kind is a **wellbeing** concern; handle it as
above. Otherwise consider a gentle reminder to the parent not to let children share contact details.

## 5. Limits you must plan around

- **The screen is a net, not a guarantee.** It is made of regular expressions. It cannot understand
  every way a child might say something. **It is written for English.** There is **no Shona or Ndebele**
  in its rules, and spelling variants, code words and text-speak will pass it. A child who writes in
  their own language and is in trouble will not be flagged. Before launch, have fluent speakers who also
  understand child-protection work extend `src/lib/ai/patterns.ts` (the tests in `tests/ai/` show how a
  rule is stated and checked), and keep doing it as you learn what children actually write.
- **Answer boxes are not read for worrying content.** Personal details typed there are removed, but a
  child who writes something worrying where an answer belongs is not flagged. The place a child is
  invited to talk is "Ask ZimTutor a question", and that is where the screen listens.
- **A model's words** are checked by guards, not by understanding (`src/lib/ai/guards.ts`). The default
  deployment uses no model at all (`AI_PROVIDER=mock`), which removes this risk entirely.
- **There is no real-time alert.** Flagged messages wait in a list. If you need to be told at once, that
  is something to add, not something that exists.
- **Reading is limited to flagged messages.** Nothing lets an administrator browse conversations, and
  that must stay so.

## 6. Records

- **The product keeps**: the flagged message (until the child's account is deleted), the review (who,
  when, outcome, note) and the audit entry. It never keeps the personal details the screen removed.
- **The operator keeps**, outside the product and under their own retention rules: an incident record
  for anything followed up. Suggested fields: date and time; the message id; what was decided and by
  whom; who was told and when; what they said they would do; the date it was checked; the date it was
  closed. Do not copy the child's words into places with wider access than `/admin/safety` has.
- **Deleting an account** removes the child's messages. If something was reported to an authority and
  you are told to keep evidence, take advice **before** the account is deleted: a parent can delete at
  any time, and nobody at ZimTutor can bring it back.

## 7. People and conduct

- Staff and volunteers with access are vetted, trained (before they get access, then each year) and
  bound to confidentiality.
- Nobody contacts a child through ZimTutor, or outside it because of something read there. All
  contact is through the parent or the authorities.
- Nobody takes screenshots, copies or discussions of flagged messages outside the people who need them.
- Report any concern about a colleague's conduct to the operator's lead, or to the authorities where the
  law requires.

## 8. Telling parents

The privacy page (`/privacy`) says what ZimTutor collects and what parents can and cannot see. Before
launch, add: who the operator is, how a parent raises a concern, what happens when ZimTutor tells them
about something (and that it may), and that deleting a child's account removes their data from the live
service at once and from backups when those expire.

## 9. Review

Review this procedure and the screen's rules at least once a year and after any incident. Count how
many messages were flagged, how many were followed up, and how long they waited. If flagged messages
are waiting longer than the schedule allows, the schedule or the staffing is wrong.
