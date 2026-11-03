# Elyra Core Design Tokens

Design tokens for the Elyra Core landing page and application UI.

## Color Palette

### Base Colors
```css
/* Background hierarchy */
--landing-bg: #0a0c10;                  /* Deep charcoal base */
--landing-surface: #12151c;             /* Elevated surface */
--landing-surface-elevated: #181c26;    /* Card/panel backgrounds */

/* Border colors */
--landing-border: #232836;              /* Default borders */
--landing-border-subtle: #1a1e28;       /* Subtle dividers */
```

### Text Colors
```css
--landing-text: #e8ecf4;                /* Primary text */
--landing-text-secondary: #a0a8b8;      /* Secondary/subheads */
--landing-text-tertiary: #6b7280;       /* Muted/captions */
```

### Accent Colors
```css
/* Primary accent - Purple (The Orb) */
--landing-accent: #8b5cf6;              /* Violet-500 */
--landing-accent-glow: rgba(139, 92, 246, 0.4);

/* Secondary accent - Teal */
--landing-accent-teal: #14b8a6;         /* Teal-500 */
--landing-accent-teal-glow: rgba(20, 184, 166, 0.3);
```

## Spacing Scale

```css
--landing-spacing-xs:  0.5rem;   /* 8px  */
--landing-spacing-sm:  0.75rem;  /* 12px */
--landing-spacing-md:  1rem;     /* 16px */
--landing-spacing-lg:  1.5rem;   /* 24px */
--landing-spacing-xl:  2rem;     /* 32px */
--landing-spacing-2xl: 3rem;     /* 48px */
--landing-spacing-3xl: 4rem;     /* 64px */
--landing-spacing-4xl: 6rem;     /* 96px */
```

## Border Radius

Restrained, architectural radii - no rounded pills.

```css
--landing-radius-sm: 4px;   /* Buttons, inputs */
--landing-radius-md: 6px;   /* Cards, modals */
--landing-radius-lg: 8px;   /* Large containers */
--landing-radius-xl: 10px;  /* Max radius */
```

## Typography

### Font Families
```css
--font-display: "Fraunces", "Iowan Old Style", "Palatino Linotype", serif;
--font-body: "Manrope", "Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif;
```

### Type Scale
```css
/* Display / Headlines */
.headline { font-size: clamp(1.75rem, 5vw, 2.5rem); }  /* 28-40px */
.subhead  { font-size: clamp(1rem, 2.5vw, 1.25rem); }  /* 16-20px */

/* Body */
.body     { font-size: 0.9375rem; }  /* 15px */
.small    { font-size: 0.875rem; }   /* 14px */
.caption  { font-size: 0.8125rem; }  /* 13px */
.micro    { font-size: 0.75rem; }    /* 12px */
```

### Letter Spacing
```css
/* Headlines: tight */
letter-spacing: -0.02em;

/* Body: subtle tightening */
letter-spacing: -0.01em;

/* Uppercase labels: open */
letter-spacing: 0.08em;
```

## Shadows

```css
--landing-shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.3);
--landing-shadow-md: 0 8px 24px rgba(0, 0, 0, 0.4);
--landing-shadow-lg: 0 16px 48px rgba(0, 0, 0, 0.5);
--landing-shadow-glow: 0 0 60px var(--landing-accent-glow);
```

## Transitions

### Easing
```css
--landing-ease: cubic-bezier(0.4, 0, 0.2, 1);      /* Standard */
--landing-ease-out: cubic-bezier(0, 0, 0.2, 1);   /* Decelerate */
```

### Duration
```css
--landing-duration-fast: 150ms;    /* Hover states */
--landing-duration-normal: 300ms;  /* Transitions */
--landing-duration-slow: 500ms;    /* Entrance animations */
```

## Component Patterns

### Button - Primary
```css
.btn-primary {
  background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%);
  color: #ffffff;
  border: 1px solid rgba(139, 92, 246, 0.3);
  box-shadow: var(--landing-shadow-sm), 0 0 20px rgba(139, 92, 246, 0.2);
  border-radius: var(--landing-radius-md);
  height: 44px;
  padding: 0 1.5rem;
}
```

### Button - Secondary
```css
.btn-secondary {
  background: var(--landing-surface);
  color: var(--landing-text-secondary);
  border: 1px solid var(--landing-border);
  border-radius: var(--landing-radius-md);
  height: 44px;
  padding: 0 1.5rem;
}
```

### Input Field
```css
.input {
  background: var(--landing-surface);
  border: 1px solid var(--landing-border);
  border-radius: var(--landing-radius-lg);
  color: var(--landing-text);
  height: 48px;
  padding: 0 1rem;
}

.input:focus {
  border-color: var(--landing-accent);
  outline: none;
}
```

### Card
```css
.card {
  background: var(--landing-surface);
  border: 1px solid var(--landing-border-subtle);
  border-radius: var(--landing-radius-lg);
  padding: 1rem;
}

.card:hover {
  border-color: var(--landing-border);
}
```

## The Orb

The Orb is the visual identity of Elyra Core - a luminous, iridescent plasma sphere.

### Colors
```css
/* Primary gradient */
background: radial-gradient(
  circle at 35% 35%,
  #c4b5fd 0%,       /* Lavender highlight */
  #8b5cf6 25%,      /* Violet core */
  #7c3aed 45%,      /* Deep purple */
  #14b8a6 70%,      /* Teal transition */
  #0d9488 100%      /* Deep teal edge */
);
```

### Glow Layers
- Inner glow: `rgba(139, 92, 246, 0.3)`, blur 20px
- Mid glow: `rgba(139, 92, 246, 0.2)`, blur 30px
- Outer glow: `rgba(139, 92, 246, 0.12)`, blur 40px

### Animation
- Rotation: 20s linear infinite
- Breathing: 6s ease-in-out infinite (opacity 0.8-1, scale 1-1.05)

## Accessibility

### Focus States
```css
:focus-visible {
  outline: 2px solid var(--landing-accent);
  outline-offset: 2px;
}
```

### Reduced Motion
All animations respect `prefers-reduced-motion: reduce`:
```css
@media (prefers-reduced-motion: reduce) {
  * {
    animation: none !important;
    transition-duration: 0.01ms !important;
  }
}
```

## Responsive Breakpoints

```css
/* Mobile first */
/* sm */  @media (min-width: 640px)  { }
/* md */  @media (min-width: 768px)  { }
/* lg */  @media (min-width: 1024px) { }
/* xl */  @media (min-width: 1280px) { }
```

## File Structure

```
frontend/
├── app/
│   ├── globals.css      # All styles including landing page
│   ├── layout.tsx       # Root layout
│   └── page.tsx         # Landing page
├── components/
│   └── Orb.tsx          # The Orb component
└── DESIGN_TOKENS.md     # This file
```
