## Design Context

### Users

Workflow engineers who build pipelines, chain API calls, and parse structured data. They work inside developer tools (terminals, editors, CI dashboards) and value clarity over cleverness. LLMs are rill's primary script authors; humans review and debug the output.

### Brand Personality

**Three words:** Precise, luminous, directional.

**Voice:** Technical and direct. No marketing language, no vague qualifiers. State what the feature does, show code, let results speak. Always lowercase "rill" — never "Rill" or "RILL".

**Emotional goals:** Energized flow (momentum, forward motion, data moving through pipes) and technical delight (satisfaction when things work elegantly).

### Aesthetic Direction

**Visual tone:** Dark-only. Neon spectrum on near-black void. References: Vercel and Linear for dark, clean developer tools with subtle gradients and precise typography.

**Theme:** Dark mode exclusively. The brand's void-on-neon identity does not translate to light backgrounds. Neon assets wash out on light surfaces.

**Core metaphor:** Data in motion. The logo's forward-leaning parallelograms, left-to-right gradients, and flowing animations all reinforce directional data flow.

**Brand source:** `internal/brand/brand-guide.html` contains the complete visual system.

### Color System

| Token | Hex | Usage |
|-------|-----|-------|
| `--void` | `#0a0a0e` | Page background |
| `--void-raised` | `#111117` | Elevated surfaces |
| `--void-card` | `#16161e` | Card backgrounds |
| `--void-border` | `#1e1e2a` | Borders, dividers |
| `--neon-yellow` | `#d4e157` | Pipe operators, warnings |
| `--neon-green` | `#4ade80` | Strings, success states |
| `--neon-cyan` | `#22d3ee` | Primary accent, keywords, links, focus |
| `--neon-blue` | `#60a5fa` | Variables, parameters |
| `--neon-indigo` | `#818cf8` | Numbers, constants |
| `--neon-purple` | `#a78bfa` | Functions, callables |
| `--text-primary` | `#e8e8f0` | Headings, primary content |
| `--text-secondary` | `#8888a0` | Body text, descriptions |
| `--text-dim` | `#555568` | Labels, comments, metadata |

**Pipe gradient:** 6-stop linear gradient (yellow -> green -> cyan -> blue -> indigo -> purple) at 135deg. Use for hero text, premium buttons, and featured elements.

### Typography

| Role | Font | Usage |
|------|------|-------|
| Display | Big Shoulders Display | Headlines, feature text (uppercase, 800 weight) |
| Technical | JetBrains Mono | Code, labels, UI chrome, inputs |
| Body | Instrument Sans | Paragraphs, navigation, descriptions |

### Motion

All animations reinforce the pipe metaphor. Motion is directional (left-to-right), rhythmic (breathing glow), and purposeful (never decorative).

| Pattern | Duration | Usage |
|---------|----------|-------|
| Glow pulse | 3s ease-in-out | Focus indicators, active states |
| Pipe flow | 2.5s ease-in-out | Loading states, progress bars |
| Spectrum shift | 6s ease-in-out | Featured elements, hero sections |
| Neon border | 4s linear hue-rotate | Premium interactive surfaces |

### UI Components

- **Buttons:** Primary (cyan bg), Ghost (bordered), Gradient (pipe gradient bg). All use monospace font.
- **Inputs:** Monospace, void background, cyan focus ring with 3px glow.
- **Chips/Badges:** Pill-shaped, semi-transparent background, neon border. Cyan (default), green, purple variants.
- **Cards:** `--void-card` background, `--void-border` border, 12px radius.
- **Code blocks:** `--void-raised` background, 10px radius, syntax-highlighted with brand neon spectrum.

### Design Principles

1. **Dark void canvas** — All surfaces use `--void-*` backgrounds. No light mode.
2. **Neon spectrum accents** — Cyan is primary. Use the full 6-color spectrum for semantic differentiation (syntax, status, categories).
3. **Monospace-first typography** — Technical UI elements use JetBrains Mono. Reserve Instrument Sans for body text only.
4. **Directional motion** — Animations flow left-to-right, reinforcing the pipe metaphor.
5. **Precision over decoration** — Every visual element serves a purpose. No ornamental gradients or gratuitous glow effects.

### Accessibility

- WCAG AA contrast ratios for all text on `--void-*` backgrounds
- Keyboard navigation support on all interactive elements
- `prefers-reduced-motion` respected for glow/flow animations
