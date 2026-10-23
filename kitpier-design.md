---
version: 1.0.1
updated: 2026-10-24
source_of_truth: design-brain/projects/kitpier.json
mock: https://claude.ai/artifact/7XBNBdyRmZgEAoACN8AbSV (v29, approved by Tasha 2026-10-24)
---

# Kitpier design system

## 1. Overview / brand and style

```yaml
personality: [editorial, quiet, confident, precise, trustworthy]
audience: Builders shipping real apps with AI coding tools, and hackathon judges opening kitpier.com cold.
emotional_intent: calm certainty. "This is serious software and my money is safe here."
look: white page, one giant wordmark, tiny uppercase type pinned to the corners, one black action in the centre.
refuses: AI-template UI, decorative colour, boxed badges, more than two typefaces.
```

Kitpier handles payments and spending limits, so the design earns trust through restraint: black on white, real
numbers, plain labels, generous space. The giant wordmark (italic *k* and *p*, upright *itier*) is the one bold
gesture; everything around it stays quiet. Reference: an editorial agency layout (logo top-left, tagline
top-centre, menu top-right, small links and legal text in the bottom corners).

## 2. Colours

```yaml
white:      { value: "#FFFFFF", role: page background (every surface) }
ink:        { value: "#111112", role: all headlines, wordmark, primary buttons, icons }
body:       { value: "#5A5A57", role: hero sentence and long body copy }
dim:        { value: "#5F5F5C", role: secondary text, captions, meta }
numeral:    { value: "#CDCDC9", role: large decorative step numbers only }
band:       { value: "#F5F5F3", role: alternate section band (stack section) }
hairline:   { value: "rgba(17,17,18,0.14)", role: dividers, card borders }
paypal:     { value: "#FFC439", role: official PayPal button only (with PayPal's own logo colours) }
contrast:
  ink_on_white: "19.0:1 (AAA)"
  body_on_white: "6.9:1 (AA, AAA large)"
  dim_on_white: "6.4:1 (AA)"
  white_on_ink: "19.0:1 (AAA)"
  numeral_on_white: "1.6:1, decorative only, never carries meaning alone (title beside it does)"
dark_mode: none in v1. The site is deliberately white; app screens follow it.
```

There is no brand accent colour. The only colour on any page is PayPal's own button and logo, shown only where
PayPal is the action (checkout) and as one small official mark in the trust row. Never recolour or redraw PayPal
assets; never use PayPal colours elsewhere.

## 3. Typography

```yaml
display: { family: "Instrument Sans", source: Google Fonts, weights: [500], italic: 500 }
body:    { family: "Lato", source: Google Fonts, weights: [300, 400], italic: 300 }
scale:
  wordmark:   { font: display, size: "clamp(70px, 16.8vw, 240px)", tracking: "-0.06em", leading: 0.86, italics: "k and p" }
  h2_section: { font: display, size: "clamp(34px, 5vw, 64px)", tracking: "-0.04em", leading: 0.95 }
  h3:         { font: display, size: 22px, tracking: "-0.02em" }
  figure:     { font: display, size: "clamp(38px, 4.8vw, 61px)", tracking: "-0.05em", use: "budget cap" }
  step_num:   { font: display, italic: true, size: "clamp(56px, 7vw, 96px)", colour: numeral }
  lead:       { font: body 300, size: "clamp(16px, 1.45vw, 19px)", tracking: "+0.045em", leading: 1.75 }
  body:       { font: body 300, size: 15-16px, tracking: "+0.035em", leading: 1.75 }
  ui_label:   { font: body 400, tracking: "+0.04 to +0.06em", use: "buttons, links" }
  micro:      { font: body 400, size: 10.5px, uppercase: true, tracking: "+0.14em", leading: 1.25 }
```

Lato Light (300) only at 15px and up; anything 14px or smaller uses Lato Regular (400) so it stays legible.
Two faces only. Instrument Sans (with true italics) for the wordmark, headlines, step titles, service names,
prices and big figures. Lato for every other piece of text. Italic display is used for emphasis words
("*production*", "*that emails a confirmation*") and the wordmark's *k* and *p*. Headlines are always ink, never
grey. The hero sentence runs on one line at 1240px and wider, balanced lines below.

## 4. Layout and spacing

```yaml
scale_px: [4, 6, 8, 12, 16, 20, 24, 32, 40, 56, 72, 112]
gutter: "max(16px, safe-area inset) left and right, at every width"
max_content: 1180px
hero: "min-height max(560px, 100svh); 3 rows: top bar / centred wordmark + sentence + CTA / bottom corners"
top_bar: "3 columns: logo left, tagline centre, menu right"
bottom_bar: "service links left (with arrows), legal right"
stacked_micro_gap: 6px
section_padding_y: "clamp(56px, 8vw, 112px)"
cta_spacing: "32px above the CTA, 20px between button and its caption"
```

## 5. Elevation and depth

Flat by default. Depth is reserved for two things: the hero CTA (soft shadow `0 12px 28px -14px rgba(0,0,0,.45)`)
and the stack card (very soft long shadow `0 40px 80px -50px rgba(0,0,0,.3)`). Everything else is separated by
whitespace and hairlines. Rationale: shadows everywhere flatten hierarchy; two lifted objects tell the eye where
the action is.

## 6. Shapes

Pills for every button (radius 999px). Cards 22px radius. No other rounded boxes: lists and steps are divided
with hairlines and dashed column rules, not boxed. One coherent answer: soft where you act, straight where you
read.

## 7. Components

```yaml
button_primary_hero: { bg: ink, fg: white, height: 56px, label: "Lato 400 18px +0.06em", padding_x: 32px, radius: pill, hover: "bg #2B2B2C" }
button_outline:      { border: "1px ink", fg: ink, padding: "9px 18px", radius: pill, hover: "fill ink, text white", use: "Sign in" }
button_app:          { padding: "8-16px vertical / 16-24px horizontal", label: "Lato 400 14-15px" }
button_paypal:       { official PayPal button, height: 50px, shape: pill }
nav_link:            { micro type, rest: "no underline", hover: "1px underline grows left to right, 200ms" }
service_link:        { "Lato 12px +0.05em, arrow ↗ right-aligned, hover inverts (ink bg, white text)" }
logo:                { "small wordmark: Instrument Sans 26px, italic k and p, links home" }
stack_card:          { bg: white, border: hairline, radius: 22px, padding: "20-32px", rows: hairline-divided }
status:              { "no boxed badges. Small uppercase Lato with a dot: filled dot = run and capped by Kitpier; ring = your own account" }
step:                { "centred column: italic numeral (numeral colour), h3, body; dashed vertical rule between columns" }
trust_item:          { "display title + micro caption; PayPal mark beside 'One checkout'" }
focus:               { "1px ink outline, 3px offset, on every interactive element" }
touch_targets:       { min: "44px (Apple) / 48px (Material); hero CTA 56px, PayPal 50px" }
```

## 8. Do's and don'ts

- Do keep the page white and the text black. Don't add an accent colour or decorative gradient.
- Do use exactly two typefaces (Instrument Sans + Lato). Don't introduce a third, including monospace.
- Do size buttons from the component table. Don't size them by eye.
- Do keep stacked micro-type at one rhythm (1.25 leading, 6px gap) and one colour (ink).
- Do make interactive things look interactive (underline on hover, pill buttons) and keep facts as plain text.
- Don't use boxed uppercase badges, bordered cards with a top rule, or dashed total lines (the AI-template look).
- Don't show PayPal colours anywhere except the PayPal button and its official mark; never redraw the logo.
- Don't let headlines go grey; ink only.
- Don't use em dashes in user-facing copy.
- Don't center long body paragraphs except the hero sentence and step columns.
- Do say what Kitpier enforces and what it only estimates; never imply we cap spend at external providers.

## Changelog

- 1.0.1 (2026-10-24): dim grey #6A6A67 -> #5F5F5C; small text uses Lato 400 (legibility feedback).
- 1.0.0 (2026-10-24): first system, from the approved landing mock (white editorial direction).
