# Concierge design outline

> The system in one breath: **gold is wayfinding** (where you are, what needs
> you, the primary action), **cream is brand surface** (identity block, table
> headers, active nav — never page background), **elevation is a hairline
> border, never a shadow**, and **density is the feature** — this is a
> daily-driver cockpit, not a marketing site. Rooted in the Scribe CHS style
> guide (gold #A8882E, cream #FAF6EC, warm grey, Arial). Benchmarks studied:
> Front/Missive (queue-first rail), Linear (typographic restraint), Stripe
> Dashboard (calm grouped sidebar).

## Information architecture

Full workspace, left rail (lg+), grouped so ten destinations stay calm:

| Group | Items | Why |
|---|---|---|
| **Work** | Inbox · Questions (badge) · Reviews | The daily loop — someone must act |
| **Knowledge** | Brand Brain · Training (badge) · Sources* | Everything that feeds the Brain |
| **Insight** | Analytics · Digest* | Reporting, not work |
| *(rail footer)* | Team* · Audit* + identity | Reference, deliberately demoted |

\* admin-only. Agents see the same structure, fewer rows — one IA to learn.
Badge discipline: a number appears ONLY on Questions/Training and ONLY for
*your* assigned open items. A number always means "your work is waiting."

**Simple view** (Q&A teammates): no rail, the slim top bar with a single
Questions link. Its minimalism is the feature — never add chrome here.

**Mobile (<lg)**: the rail hides; the top bar shows the flat item list with
horizontal scroll. Same components, no parallel IA.

## Layout

- Rail: `w-56 sticky top-0 h-screen bg-white border-r border-neutral-200`,
  cream identity block at top, `mt-auto` footer (admin refs, view toggle,
  brand switcher, email).
- Content: `flex-1 min-w-0 max-w-[1200px] px-6 lg:px-8 py-6` — the old
  `max-w-5xl` cage is gone; the inbox table earns the width.
- Body background stays `bg-neutral-50`; every surface is
  `rounded-xl border border-neutral-200 bg-white`. No shadows, ever.

## Typography (Arial, per brand guide)

| Role | Recipe |
|---|---|
| Page title | `.page-title` — 13px/700 caps, tracking .14em, gold, hairline rule under. The signature; never inflate it. |
| Group/section labels | 10–11px/700 caps, tracking .14em, warm-grey (`.nav-group-label`, cream table headers) |
| Body / table | 14px `text-neutral-800`; `leading-snug` in dense rows, `leading-relaxed` only in message bodies |
| Meta / timestamps | 12px `text-neutral-500`, dates and counts always `tabular-nums` |
| Chips | 10–11px; tint families in `lib/ui` + `lib/categories` are semantic — don't restyle |
| Display numbers | Analytics tiles only: `text-2xl font-bold tracking-tight tabular-nums` |

## The gold grammar (wayfinding)

- **Active nav** = cream fill + 3px gold left spine (`.nav-item-active`) —
  deliberately quotes the ticket workspace's `border-l-4` zone bands, so the
  chrome and the content speak one language.
- **Nav badges** = solid gold pill (`.nav-badge`). Amber is reserved for
  needs-attention states inside content (unassigned, expired, waiting).
- **View tabs** (inbox) = gold underline (`.tab-active`). Tabs change *what*
  you look at; pill chips below only *filter* it.
- **Focus ring** = global gold `:focus-visible` outline; selection is a gold
  wash. Keyboard users get the brand for free.
- **Primary buttons** = `.btn-primary` gold. Semantic green/red survive.

## Component recipes

- Card: `rounded-xl border border-neutral-200 bg-white` (+ `p-4`).
- Table: cream `thead`, 11px caps headers, row `hover:bg-cream/40`,
  `border-b border-neutral-100`, urgent rows keep `border-l-4 border-l-red-500`.
- Empty state: `.empty-title` ("All clear") + one quiet sentence, `py-10+`.
- Inline editors (status/urgency/assignee selects): visible
  `border-neutral-300`, chip-tinted backgrounds.
- Zone bands (ticket page): navy status / blue system inputs / amber added
  context / gold reply — the product's best idea. Do not touch.

## Do-not list

- Don't add shadows, icon fonts, or a component library.
- Don't put cream on page backgrounds or gold in filter chips.
- Don't badge anything that isn't the signed-in user's own queue.
- Don't add chrome to the Simple view.
- Don't restyle the semantic chip tints (category/status/priority/coverage).
