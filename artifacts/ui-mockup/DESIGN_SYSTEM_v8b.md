# MissionPay design system v8b (approved 14/11/2026)

Reference mockup: `index-v8b.html`. Voice borrowed from Avalanche Builder Hub (build.avax.network): heavy uppercase display with a red full stop, mono micro-labels, triangle grid. Do not copy their logo, imagery or copy.

## Type
| Role | Font | Size (web) | Size (deck) | Notes |
|---|---|---|---|---|
| Page h1 | Archivo 900, UPPERCASE | 56–64px desktop, 36px mobile | 44–54pt | tracking −0.02em, line-height .95, ends with red `.` |
| Section h2 | Archivo 900, UPPERCASE | 36–40px, 28px mobile | 28–32pt | red `.` |
| Card / table title | Geist 600, sentence case | 18–20px | 16–18pt | never uppercase |
| Body | Geist 400 | **16–17px**, line-height 1.55 | **14–16pt** | max ~70ch |
| Secondary text | Geist 400 | **≥14px** | **≥12pt** | ink-2, never lighter than #5E646E on paper |
| Micro-label (kicker) | Geist Mono 500, UPPERCASE, +0.12em | 12px | 10pt | preceded by an 8px red square |
| Data | Geist Mono | 14px | 12pt | hashes, addresses, revert names only |
Nothing on the web below 13px; nothing on slides below 10pt (sources only).

## Colour (meaning first, then rhythm)
| Token | Hex | Use |
|---|---|---|
| ink | #0F1115 | text, dark buttons |
| paper | #F7F6F2 | page |
| brand red | #E84142 | primary CTA, red full stop, kicker square, blocked/attack |
| green | #0B7A4B (bg #E3F2EA) | paid, valid, allowed |
| amber | #B7791F (bg #FBF0DC) | pending, queued, MOCK/simulation |
| blue | #2457C5 (bg #E7EEFB) | links, data, info, on-chain references |
| navy | #14213D | dark proof bands (instead of near-black) |
| tints | sand #ECE7DD · rose #FBEDEA · slate #E6ECF3 · mint #E6F2EC | section bands, each page hero gets one |
Colour never alone: every status also has a word.

## Corners (not everything rounded)
| Element | Radius |
|---|---|
| Buttons, chips, segmented controls | pill (999px) |
| Content cards, hero product panel, illustration tiles | 14–20px |
| Tables, receipts, code/`cast` blocks, data panels, tx rows | **4px (square-ish)** |
| Status tags | 6px |
| Inputs | 10px |
Full-width bands and red divider bars: 0.

## Layout
- Each page: tinted hero band with triangle grid (hero only), kicker + h1 + lede + actions.
- Proof sections on navy band with a 12px red bar above.
- Section padding 56–72px; card gap 16px; content max width 1200px.
- Outcome = filled panel with a 4px left border in the status colour (red/green/amber), not just a tag.
