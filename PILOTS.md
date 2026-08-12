# Pilots

How to get the first three facilities using this, what to send them, and what
gets signed at each step. Written the night the first full letter came out of
the pipeline, because that letter is the sales artifact everything below
depends on.

Standing honesty rules for all outreach, before anything else:

- The sample letter is generated from a synthetic case and is labelled as
  such. It demonstrates the writing and the citation checking, not a track
  record. We have no win rate and we do not imply one.
- Public statistics are attributed. HHS OIG and KFF have both published that
  most Medicare Advantage denials are never appealed and that a large majority
  of appealed denials are overturned. Say "federal reviews have found",
  not our own numbers.
- No PHI moves in Phase A, at all, under any framing. The codebase enforces
  this and the agreement says it.
- Nothing here is legal advice. The agreement skeleton below and the first
  BAA a facility sends both get one review by a healthcare attorney before
  signature. Budget one to four thousand dollars, once, for templates that
  serve every pilot after.

## The offer

One sentence, and it is the whole pitch: send us one denied Medicare
Advantage claim with patient identifiers removed by your staff, and within
two business days you get back a complete appeal letter in which every
factual and legal assertion carries a verbatim quote from its source, checkable
by hand without our software.

Free in the evaluation phase. The eventual model is contingency on recovered
dollars (the operator console is already built around 15 percent), which means
the facility risks nothing and the incentive conversation is one sentence long.

## Who to contact

### Tier 1: channel partners, one deal covers many facilities

Revenue cycle and denials companies already fight these denials for dozens or
hundreds of providers, already operate as HIPAA business associates, and can
evaluate the letter in an afternoon. The right size is regional and mid
market: large enough to have volume, small enough that the founder or a VP
answers email.

Real firms in this space, largest first, named so the category is concrete:
R1 RCM, Ensemble Health Partners, Savista, CorroHealth, Aspirion, Revecore,
EnableComp, Knowtion Health. The last four specialise in complex claims and
denials specifically. The national ones move slowly and may see us as a
feature; treat them as later conversations. The practical Tier 1 target is
the regional equivalent found through an HFMA chapter directory, plus the
post acute consulting firms that serve SNF chains: Zimmet Healthcare Services
Group and Richter Healthcare Consultants are the named examples of the
category, and CliftonLarsonAllen's senior living practice is the accounting
side of the same channel.

Titles: VP of Operations, Director of Appeals, Chief Growth Officer, or the
named founder at regional shops.

### Tier 2: skilled nursing facilities directly

The corpus is built for their exact fight: 42 CFR 409.31 level of care
denials and the 42 CFR 422.101(b) argument that a Medicare Advantage plan
applied its own criteria instead of Medicare's. Independent facilities and
small regional chains decide fast. National chains for later: Ensign Group,
PACS Group, Genesis Healthcare, Life Care Centers of America, Trilogy Health
Services are the names, and the way in is a regional director, never
corporate.

Build the local list in one afternoon:

1. CMS Care Compare, filter to skilled nursing facilities in the target
   state, export. Cross off the ones in national chains.
2. The state AHCA/NCAL affiliate directory (in California that is CAHF) and
   the state LeadingAge chapter for the nonprofits.
3. For each facility: the Administrator's name is on the state licensing
   lookup and usually on the facility website. At independent SNFs the person
   who actually fights denials is the Business Office Manager; at chains it
   is the Regional Director of Reimbursement.
4. Twenty five names, one spreadsheet: facility, chain or independent, name,
   title, email, date sent, reply, next step.

### Tier 3: hospitals

Critical access and community hospitals, through the state hospital
association directory. Titles: Director of Revenue Cycle, Denials Manager,
Director of Case Management. Longer sales cycle than SNFs, larger claims.
Inpatient rehab facilities belong here too; AMRPA is the association.

Scope note that goes in every agreement: pilots cover skilled nursing and
inpatient rehabilitation denials only. Those are the two service types with
statutory criteria wired in. A home health denial would be argued under the
wrong standard today, so it is excluded in writing until the criteria are
written down.

## The messages

Send from a medeal.app address, never gmail. Attach the sample letter as a
PDF labelled "demonstration case, synthetic data". Fifteen sends a week so
replies get same day answers. Follow up on day four and day ten, then stop.

### Email A: SNF administrator or business office manager

Subject: The appeal letter for your next MA level of care denial

Body:

> Hi [name],
>
> When [plan name most common in the state] denies a skilled stay for "no
> longer requires skilled level of care," someone at [facility] has to write
> the appeal, with the regulation cited and the chart quoted, before the
> deadline. Federal reviews have found most of these denials are never
> appealed and most appeals that are filed win.
>
> I built software that writes that letter. Every assertion in it carries a
> word for word quote from your clinical record or from the Medicare
> regulation it rests on, reproduced in a citation appendix so your team can
> check every line by hand. The attached sample was generated end to end by
> the system on a synthetic case.
>
> The offer: email me one real denial with patient identifiers removed by
> your staff, and you will have the finished appeal back within two business
> days. Free. If the letter is not obviously better than what the plan
> deadline usually allows anyone to write, delete my address.
>
> [name]
> [medeal.app address, phone]

### Email B: RCM firm or consulting partner

Subject: Verbatim cited MA appeal letters, generated, checkable by hand

Body:

> Hi [name],
>
> Your team appeals Medicare Advantage level of care denials at volume. The
> bottleneck is writing: the regulation, the chart, the plan's own criteria
> language, assembled per case under deadline.
>
> I built a system that generates the letter with every assertion anchored to
> a verbatim quote from its source, verified character for character before
> the letter renders, with a citation appendix a reviewer checks without
> trusting the software. Sample attached, generated on a synthetic case.
>
> If it holds up against two or three of your real (de-identified) denials,
> the conversation is about running it under your name across your book.
> Twenty minutes this week?

### Email C: hospital revenue cycle director

Same skeleton as A with the first paragraph swapped:

> Your denials team has more MA medical necessity denials than hours to
> appeal them, and the ones that go unappealed are written off. Federal
> reviews have found the majority of appealed MA denials are overturned.

### LinkedIn DM (when no email found)

> I build software that writes Medicare Advantage appeal letters where every
> sentence carries a verbatim, hand checkable quote from the chart or the
> regulation. Looking for two or three facilities to evaluate it on real
> (de-identified) denials, free. Worth 15 minutes?

### Follow ups

Day four: "Attaching the sample again in case it got buried. One redacted
denial, finished appeal back in two days, free." Day ten: "Last note from me.
If denials are someone else's desk, I would be grateful for the name."

## The paperwork, Phase A (no PHI)

One combined document, two to three pages, so a facility signs once. E-sign
with any standard tool; you sign first, they countersign, the executed PDF
goes in a contracts folder with a copy off machine.

Skeleton for the attorney to finish. Square brackets are blanks.

MUTUAL NDA AND PILOT EVALUATION AGREEMENT

1. Parties. [Your LLC], "Vendor", and [Facility legal name], "Facility",
   effective [date].
2. Purpose. Facility will evaluate Vendor's appeal drafting software using
   de-identified denial and clinical documents Facility selects.
3. No protected health information. Facility will remove all patient
   identifiers per the HIPAA Safe Harbor method (45 CFR 164.514(b)(2))
   before transmitting anything. Vendor will not accept, request, or store
   PHI under this agreement, and will delete on notice any document
   Facility believes was insufficiently de-identified. This agreement is
   not a business associate agreement and does not authorise PHI exchange.
4. Scope. Skilled nursing and inpatient rehabilitation denials only. Up to
   [five] denials during the term.
5. Review and use. Letters are drafts. Facility's own staff review, edit,
   sign, and submit any letter, and Facility is solely responsible for what
   it files. Vendor is a document preparation tool, not counsel.
6. Confidentiality. Mutual, standard carve outs, [three] years.
7. Intellectual property. Vendor keeps the software and everything about how
   it works. Facility keeps its documents. Facility grants Vendor a licence
   to use feedback and to use aggregate, de-identified evaluation results.
8. Fees. None during evaluation. Any continuing engagement requires a
   separate written agreement.
9. Term and termination. [Sixty] days, either party may end it on written
   notice, sections 3, 6, 7 survive.
10. No warranty; limitation of liability. Evaluation software provided as
    is; liability capped at one hundred dollars; no indirect damages.
11. Governing law. [Your state]. Signature blocks for both parties.

Signing mechanics: at an independent SNF the Administrator or CFO can sign
same week. At a chain expect corporate legal and one to three weeks; offer
to work from their template instead, and read it against the skeleton above,
especially 3, 5, and 7.

## The paperwork, Phase B (live PHI), in order

Do not start Phase B until a facility has read Phase A letters and wants
them for filing. Then, in sequence:

1. Entity. Form the LLC before signing anything Phase B. State filing plus
   registered agent, then an EIN from the IRS (free, same day online), then
   a business bank account. Days, not weeks.
2. Insurance. Technology errors and omissions plus cyber liability, one
   million per occurrence, two million aggregate, which is what facility
   vendor agreements demand. A startup focused broker quotes this in a week.
3. Infrastructure that can sign BAAs, before any PHI arrives. Every vendor
   touching PHI must have one with us: the model provider (Google Cloud
   Vertex AI and AWS Bedrock cover this under their standard cloud BAAs,
   self serve; Anthropic offers HIPAA ready API organisations through their
   sales team), the database, and the host. The current free tier model
   endpoints and Netlify hosting do not qualify; plan roughly a week to
   consolidate PHI touching pieces onto one cloud whose BAA covers them.
   Only after those BAAs exist does MODEL_BAA_CONFIRMED get set and
   PHI_MODE move to live, and the code refuses the shortcut.
4. Their vendor packet. Expect a W-9, a certificate of insurance, a security
   questionnaire, and their BAA template. Answer the questionnaire from
   what is actually built: column level PHI encryption under a dedicated
   key, forced password rotation and two factor enrolment for every writing
   role, per action audit logging, prompts and completions never stored,
   one enforced model boundary in code. Be equally plain about what is not
   in place yet, notably SOC 2.
5. The BAA, theirs usually. Attorney reads the first one. Watch: breach
   notification window (they will ask for five to ten business days; fine),
   flow down to our subcontractors (that is the cloud BAAs in step 3),
   return or destruction of PHI at termination, audit rights scoped to
   reasonable notice, indemnification capped, ideally at fees paid.
   Explicitly exclude 42 CFR Part 2 substance use disorder records from
   scope.
6. The services agreement. Contingency percentage, what counts as recovered,
   when invoices issue (the invoicing flow in the product already models
   this), termination, and the same review and responsibility clause as
   Phase A section 5: their staff signs every letter that gets filed.
7. Countersign, calendar the insurance renewal and the BAA obligations, and
   only then upload the first real denial.

## The first week, concretely

Day 1: read five fresh sample letters; fix anything embarrassing. Form the
LLC. Day 2: build the 25 name Tier 2 list and the 10 name Tier 1 list for
one state. Day 3: attorney engaged on the Phase A skeleton; first 15 emails
out. Day 4 and after: answer replies same day, follow ups on schedule, and
the first facility that sends a redacted denial gets its letter back inside
48 hours even if that means running the workflow by hand.
