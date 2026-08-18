# Swiftline Portal- Form Standards

Every form in the portal follows these rules. The Create Business Account wizard
(`components/business-accounts/`) is the reference implementation; new forms copy
its primitives rather than inventing their own.

Applies to: business account create/edit, branch form, staff/user form, shipment
draft, consignor KYC, quote request, support ticket, profile, credit forms,
DPD label forms.

---

## 1. Field primitives

Use the shared controls. Do not hand-roll `<input>` / `<select>`.

| Need | Use |
| --- | --- |
| Text, email, number, url | `Field` (`FormFieldControls.tsx`) |
| Single choice | `SearchableSelect` |
| Multiple choice | `MultiSearchableSelect` |
| Boolean | `CheckboxField` |
| Phone country code | `CountryCodeField` |
| Text with suggestions, unlisted values allowed | `ComboBoxField` |
| Address | `AddressAutocompleteField` (§4) |
| Explanation | `InfoTooltip` (`components/ui/InfoTooltip.tsx`) |
| File | `DocumentInput` |

### Mandatory fields
- Every mandatory field carries a visible `*` next to its label, not only inside
  the placeholder.
- The asterisk is rendered by the control from `required`, never typed into the
  label string by the caller.
- The form header states what the asterisk means once, at the top.

### Placeholders and examples
- Every field with a format constraint shows an example: `e.g. 27ABCDE1234F1Z5`,
  `e.g. ABCDE1234F`, `e.g. 400001`.
- The example reflects the currently selected country, not a fixed value.

---

## 2. Real-time validation

Validation runs **while the user types**, not only on blur or on step change.

Each field is in exactly one state:

| State | Trigger | Indicator |
| --- | --- | --- |
| `idle` | untouched, or empty and optional | no icon |
| `validating` | async check in flight (uniqueness, address) | spinner |
| `valid` | passes **format + rule** checks | green tick |
| `invalid` | fails a check | red warning icon + message below |

A field may additionally carry a **warning**: something the user should see but
which does not block submission, shown in amber beneath the field. Warnings are
suppressed while an error is showing, so a field never carries two competing
messages, and they never affect the tick or the submit gate. Use one where a
value is suspicious rather than wrong- for example a GSTIN whose embedded PAN
differs from the PAN captured separately, which is usually a typo but can be
legitimate.

Rules:
- A green tick means the value **passed validation**. Never show a tick just
  because a field is non-empty.
- The error message says what is wrong and what is expected- not "Invalid".
- Async checks (duplicate email, duplicate mobile, address lookup) are debounced
  (~400 ms) and cancel-safe: a stale response must never overwrite a newer value.
- The final submit button stays **disabled** until every mandatory field is
  `valid`. Step "Continue" buttons follow the same rule for that step's fields.
- Validation rules live in one pure module per domain and are shared by the live
  indicator, the step gate, and the submit gate. Never write a rule twice.
- The backend re-validates everything. Frontend validation is UX, never the
  security or integrity boundary.

### Fields that must be validated
email, mobile number, postcode, GSTIN, US Tax ID (EIN/SSN/ITIN), PAN and other
registration numbers, bank details, website URL, credit limit, dates.

---

## 3. Dropdowns

- Any list longer than ~8 options must be searchable.
- Free-text entry is not allowed where a canonical list exists (state, country,
  job title, department, industry, company type, currency).
- Lists that may not cover every case end with **"Other"**, which reveals a
  free-text field. See `DesignationField` in `components/users/StaffFields.tsx`
  for the reference pattern.
- A stored value that is no longer in the list must remain visible and
  selectable- never silently replaced. Editors handle this by injecting the
  stored value into the option list, or by routing it into the "Other" box.
- Dependent dropdowns reset their children: changing country clears state, and
  clears postcode if it no longer validates.

### Country, state and city

All three come from the shared geography reference- never hand-written lists,
and never Google (Places can confirm a state on an address it returns, but it
cannot enumerate the states of a country).

**Country**- `portalCountries` (`lib/portalCountries.ts`) is the canonical
list. `countryOptions` is derived from it, so an option cannot exist without the
state and city data behind it. Adding a country means adding it there *and* to
the backend mirror at `services/reference/portalCountries.ts`.

**State**- a dropdown driven by the selected country:

```
GET /api/v1/reference/countries/:iso2/states
    -> { states: [{ name, code }] }
```

- Countries with no subdivision data (21 of them) fall back to a free-text
  field rather than an empty dropdown.
- A stored value that is not on the list stays selectable, labelled
  `(current)`, so an older record is never silently rewritten.
- Changing the country clears the state and the city.

**City**- a `ComboBoxField`: suggestions from the selected state, but **free
text is always accepted**.

```
GET /api/v1/reference/countries/:iso2/states/:stateCode/cities
    -> { cities: [name] }
```

- The dataset misses smaller towns and covers no cities at all for 27
  countries, so forcing a selection would make real addresses unenterable.
- Suggestions are capped at 50 per query; some states have thousands.
- Changing the state clears the city.

**Consuming it from a form:** use `fetchStates` / `fetchCities` from
`lib/geography.ts`. They cache per country and per state for the session and
de-duplicate concurrent requests, so several controls mounting at once cost one
call. On failure they resolve to an empty list and the field degrades to free
text- a lookup outage must never block a form.

**Where the data comes from:** the compact files under `backend/data/reference/`
(~2.7 MB) are **committed**, and are all the app ever reads. The server loads
states once and cities one country at a time; nothing is bundled into the
browser.

They are generated from `countries+states+cities.json` (45 MB, 250 countries,
5,308 states, 152,970 cities), which is **git-ignored on purpose**- keeping a
45 MB blob in history forever to produce 2.7 MB of output is a bad trade, and
the app does not need it to run. A fresh clone starts with no extra steps.

Regenerating is a deliberate, occasional act: put the dataset back at
`portal/countries+states+cities.json`, run `npm run build:reference-data --
--force`, and commit whatever changes under `backend/data/reference/`.

Validation is server-side: a submitted state must belong to the selected
country, compared ignoring case, accents and punctuation so a legacy spelling
survives an unrelated edit.

---

## 4. Address capture

Every address block uses `AddressAutocompleteField`. This covers: business
account address, billing address, pickup, delivery, branch, warehouse, sender
and receiver.

**Provider is chosen server-side by country:**

| Country | Provider | Search by |
| --- | --- | --- |
| GB | Ideal Postcodes (Royal Mail PAF) | postcode |
| everywhere else | Google Places | free text |

The placeholder tells the user which, so a postcode-only field never looks
broken.

```
POST /api/v1/address-lookup/autocomplete   { input, countryCode, sessionToken }
GET  /api/v1/address-lookup/places/:placeId?countryCode=&sessionToken=
```

Available to **any signed-in user**, clients included, and rate limited because
it reaches paid third-party APIs.

Behaviour:
1. User types → debounced 400 ms, minimum 3 characters, biased to the selected
   country.
2. User picks a suggestion → the form fills **address line 1, city, state and
   postal code**.
3. The user can still edit every populated field, and **Address Line 2**
   (building / floor / unit / landmark) is never touched by a lookup.
4. Manual entry is always available. The field *is* the address line, not a
   separate search box, so an unconfigured, rate-limited or failing provider
   degrades to plain typing rather than blocking the form.

Implementation rules:
- **One session token per address entry**, from the first keystroke to the Place
  Details call, then discarded. Without it Google bills every keystroke
  separately- put this in before rolling autocomplete onto more forms.
- Lookups go through the backend; the API keys never reach the browser.
- The returned state is resolved against the country's state list
  (`matchStateName`, ignoring case, accents and punctuation) so the dropdown can
  actually select it. No match leaves the field empty for the user to pick,
  rather than storing a value the dropdown cannot show.
- Results carry the query they answered, so a slow response for an old query is
  never shown against a newer one.
- Latitude and longitude are **not** captured for account addresses- a
  registered or billing address is a postal record, not a routing target. Add
  them where they drive something, such as pickup and delivery.
- Selecting a suggestion, and any later manual edit of an autocompleted field,
  should be written to the audit log (`ADDRESS_SELECTED`,
  `ADDRESS_MANUALLY_MODIFIED`). The shipment flows do this; the account forms do
  not yet.

---

## 5. Tooltips and help

Every field, button, module and technical term that is not self-explanatory
carries an `InfoTooltip`.

- Tooltip copy lives in one place per form (`lib/<form>Tooltips.ts`), not inline
  in JSX, so wording stays consistent and reviewable. The business account
  wizard's is `lib/businessAccountTooltips.ts`.
- The exception is a shared control whose tooltip describes *its own behaviour*
  rather than a field's meaning- `AddressAutocompleteField` explaining how
  search works, for example. That copy stays with the component, because it is
  the same wherever the control is used and does not belong to any one form.
- Only where it adds something. Fields whose label already says everything
  (First Name, Company Name) get no icon; an icon that restates its label
  teaches users to ignore all of them. Cover anything with a format, a
  restriction, a consequence, or an acronym.
- Tooltips belong on **buttons, section headings and document types** too, not
  just inputs- those are where the unexplained jargon usually is.
- A tooltip answers: what the field means, what to enter, the accepted format,
  why it is needed, and any restriction.
- Two sentences maximum.
- Opens on **hover, keyboard focus, and tap**. Tap-to-open must close on the
  next outside tap or Escape- hover-only tooltips are unusable on touch
  devices.
- The bubble **flips its alignment near a viewport edge** rather than hanging
  off screen. Position is measured in the hover and tap handlers, so it is
  already correct on the first frame that shows it.
- The icon is a real focusable element with an accessible name; the text is also
  exposed to screen readers.
- Never put information that is required to complete the field *only* in a
  tooltip- that content belongs in the helper line.

---

## 6. Unsaved changes

Any form that can lose user input warns before navigation. One line does it:

```ts
useUnsavedChanges(isDirty);   // lib/useUnsavedChanges
```

That covers `beforeunload` (tab close, reload, external navigation) **and**
registers the form with a shell-level registry, so the sidebar guards in-app
navigation without knowing which form is open. Adding the guard to a new form
never means touching the shell.

- Track `dirty` by comparing current values to a snapshot of the form as it was
  opened, not by "any keystroke happened"- clicking through a wizard's steps
  is not an edit.
- Clear it as soon as the server has the data, so the confirm does not fire on
  the redirect that follows a successful save.
- Files, uploads and multi-selects count as unsaved work too, not just typed
  fields.
- The registry holds no render state, so registering does not re-render the
  shell; the guard reads it at click time.
- `useConfirmLeave()` returns the guard for anywhere else that navigates- a
  `<Link onNavigate>` or a `router.push` that would abandon a form.

Currently guarded: business account wizard, branch form, add staff, profile.

---

## 7. Duplicate prevention

### Duplicate submissions
- The submit button disables on click and stays disabled until the request
  settles.
- Create requests send an `Idempotency-Key` header, held in a ref so a retry of
  the same attempt reuses it. The server records the key against the created
  record and replays that record for a repeat instead of creating a second.
- This covers what the disabled button cannot: a duplicate tab, a retry after a
  timeout, or a client that never saw the first response.
- Keys expire after 24 hours.

### Duplicate accounts and customers
- Uniqueness is enforced by **partial unique indexes**, not only by a pre-flight
  check- two simultaneous requests can both pass a pre-flight query.
- The pre-flight check (`/validate-unique`) exists for the inline red/green
  indicator; it is advisory and never the only guard.
- Business accounts are unique on contact email, contact country code + mobile,
  and registration ID- **excluding rejected accounts**, so a rejected applicant
  can re-apply with the same details.
- Registration ID is indexed via `registrationIdKey`, which is blank for a
  masked US SSN or ITIN. Two unrelated people whose numbers end in the same four
  digits share the string `•••-••-6789` and must not collide.
- A 409 from the server is surfaced on the offending field, not as a generic
  banner.

> **Before deploying an index change:** MongoDB refuses to build a unique index
> over a collection that already holds duplicates, and the failure surfaces at
> startup. Run `npm run backfill:registration-id-keys` then
> `npm run check:duplicate-accounts`, and clear anything reported first.

---

## 8. Audit trail

Record creation and every amendment for anything a customer or auditor may
dispute: business accounts, branches, users, credit, shipments.

Each entry stores: action, entity type, entity id, actor, timestamp, and a
metadata payload with the **changed fields (before → after)**.

Identity numbers- registration ID, GSTIN, mobile, the encrypted tax ID- are
recorded as `[changed]` with no values. An audit trail that copies every Aadhaar,
PAN, GSTIN and SSN into a second, longer-lived collection is a bigger liability
than the gap it closes. Never log document contents or passwords either.

An audit write must never fail the operation it records: the save has already
happened by the time it runs, so a logging failure is caught and reported, not
propagated.

Business accounts emit `BUSINESS_ACCOUNT_CREATED`, `_UPDATED` (with the diff),
`_SUBMITTED` and `_STATUS_CHANGED`.

---

## 9. Sessions

One active session per user account, enforced **server-side**. Authentication is
JWT, which on its own cannot express "one device at a time"- a token stays valid
until it expires no matter what happens elsewhere. So every token carries a
`sid` claim naming a `UserSession` record, and `attachUser` refuses a token whose
session has ended.

**The newest login wins.** Logging in elsewhere ends the previous session; the
displaced device is told why on its next request. Refusing the *new* login
instead would mean a laptop closed without signing out locks someone out of
their own account.

```
SINGLE_SESSION_ENFORCED=false     # default: track and audit, refuse nothing
SESSION_IDLE_TIMEOUT_MINUTES=30
```

- The flag is what makes this safe to deploy: sessions are recorded and audited
  from day one, but nothing is refused until it is switched on, and switching it
  back off is a config change rather than a redeploy.
- A token with **no `sid`** predates the feature and is honoured until it lapses,
  so deploying does not sign everyone out mid-task.
- `lastSeenAt` drives idle expiry and is written at most once a minute- idle
  timeout does not mean a database write on every request.
- Token refresh keeps the same session; only a login opens one. Otherwise every
  refresh would supersede the device doing the refreshing.
- Logout ends the session server-side as well as clearing the cookie, so an
  access token still held in memory stops working immediately.
- Session start and end are audited with IP, device and the end reason
  (`logout`, `superseded_by_new_login`, `terminated_by_admin`, `idle_timeout`).
- Admins can list and terminate a user's sessions
  (`GET`/`DELETE /api/v1/users/:id/sessions`)- the way to free an account whose
  only live session is on a device the user no longer has.
- The reason is surfaced on the login screen. Being bounced back with no
  explanation is reported as the app logging people out at random.
- Opening a duplicate tab is allowed (same session) but must not permit
  duplicate submissions- see §7.

---

## 10. Responsiveness

Every form is verified at three widths before it ships:

| Target | Width | Expectation |
| --- | --- | --- |
| Mobile | 360 px | single column, no horizontal scroll, tap targets ≥ 44 px |
| Tablet | 768 px | two columns where it helps, dropdowns fit the viewport |
| Desktop | 1280 px+ | full grid layout |

- Dropdown panels flip upward near the viewport bottom and never exceed the
  screen width.
- Tooltips reposition rather than overflow.
- Step navigation stays usable on mobile (stacked, not a cramped row).

---

## 11. Checklist for a new or amended form

- [ ] Mandatory fields marked with a visible `*`
- [ ] Format examples in placeholder or helper text
- [ ] Live validation with green tick / red warning on every important field
- [ ] Submit disabled until all mandatory fields are valid
- [ ] Validation rules shared with the backend (mirrored module, kept in sync)
- [ ] Long dropdowns searchable; "Other" reveals a free-text field
- [ ] Country from `portalCountries`; state dropdown driven by country
- [ ] City is a combo box that still accepts an unlisted town
- [ ] Changing country clears state and city; changing state clears city
- [ ] Addresses use `AddressAutocompleteField`, manual entry still possible
- [ ] Building / floor / unit / landmark editable separately
- [ ] Tooltips on non-obvious fields, working on hover, focus and tap
- [ ] Unsaved-changes warning on `beforeunload` and in-app navigation
- [ ] Duplicate submission blocked client-side and by idempotency key
- [ ] Uniqueness backed by a DB unique index
- [ ] Audit entry on create and on amendment
- [ ] Verified at 360 / 768 / 1280 px
