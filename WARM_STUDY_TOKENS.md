# Warm Study token review

PrepMate now uses one CSS variable collection in `src/index.css`. `:root` is the light mode and `:root[data-theme="dark"]` is the dark mode. Existing semantic variable names are preserved so every current frame and component inherits the theme without changing its structure.

## Colour changes

| Token | Previous light | Warm Study light | Previous dark | Warm Study dark |
|---|---:|---:|---:|---:|
| `--paper` | `#F7F8FC` | `#F4F0E8` | `#0C0D12` | `#0F100D` |
| `--surface` | `#FFFFFF` | `#FFFFFF` | `#14161D` | `#171814` |
| `--surface-raised` | `#FFFFFF` | `#FFFFFF` | `#1A1C24` | `#171814` |
| `--surface-muted` | `#F1F2F7` | `#FAF7F1` | `#20222C` | `#1E201B` |
| `--ink` | `#0B0C10` | `#17150F` | `#F5F6FA` | `#F2EEE4` |
| `--muted` | `#5E6472` | `#6A6357` | `#A7ACB8` | `#A39C8E` |
| `--border` | `#DFE2EA` | `#E2DACB` | `#2F323C` | `#2A2B25` |
| `--indigo` | `#4F46C8` | `#1F5C52` | `#9189FF` | `#7FC2B3` |
| `--indigo-deep` | `#37309B` | `#174840` | `#AAA5FF` | `#9BD2C6` |
| `--indigo-soft` | `#EEEDFF` | `#E4EEEA` | `#292644` | `#20352F` |
| `--gold` | `#C49A55` | `#B5673E` | `#D3AA67` | `#D9956A` |
| `--success` | `#16794F` | `#2F6B3F` | `#5BC391` | `#75B486` |
| `--success-soft` | `#E8F5EF` | `#E5EFE6` | `#142A21` | `#203126` |
| `--warning` | `#85460D` | `#8A5B00` | `#F0A85F` | `#E1B456` |
| `--warning-soft` | `#FFF1DF` | `#F6ECD5` | `#352515` | `#372E19` |
| `--danger` | `#B42318` | `#A3322A` | `#FF8A80` | `#E78981` |
| `--danger-soft` | `#FFF0EE` | `#F6E5E2` | `#351C1C` | `#3B211E` |

Landing-specific semantic tokens were added: `--hero-background`, `--hero-foreground`, `--hero-muted`, and `--accent-on-ink`. They keep the dark editorial hero legible in both modes while using the same Forest family.

Premium surface tokens were also added:

- `--border-strong`: `#CFC3B1` in light mode and `#41433A` in dark mode for editorial rules and key card outlines.
- `--surface-brand`: `#F7F2E9` in light mode and `#1B1C17` in dark mode for navigation and branded surface treatments.

## Type, shape, depth, and motion

- `--display-font`: changed from DM Sans usage to `"Fraunces", serif`, weight 500, optical sizing enabled.
- `--ui-font`: `"Inter", sans-serif`; body 400, labels 500/600 according to role, buttons 600.
- Display tracking: `-0.015em`; short uppercase labels: `0.06em`.
- Numeric displays and timers: tabular figures.
- `--radius-small`: `6px`.
- `--radius-medium`: `10px`.
- `--radius-large`: `16px`.
- `--radius-feature`: `22px`.
- `--shadow-1`: changed to `none`.
- `--shadow-2`: changed to `0 16px 40px rgba(23, 21, 15, 0.08)` in light mode and the dark-palette equivalent.
- `--motion-duration`: `220ms`.
- Icon stroke: `1.25px`, square caps, miter joins.
- Focus ring: `2px` Forest.
- Page texture: 3% paper grain on the page background only.

## Scope note

No existing frame, section, card, row, navigation item, component, copy string, data value, grid position, or spacing relationship was changed. The current repository does not contain a Login frame. A new Login frame and new before-and-after board sections were not created because doing so would conflict with the explicit structure and copy freeze. The existing Case Study board remains in place and receives the Warm Study theme with every other existing frame.
