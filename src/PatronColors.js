/**
 * Numeric 0xRRGGBB tints for patron / player outfits (multiplied with mesh base color).
 */
export const PATRON_TINT_COLORS = [
    0xffffff,
    0x88ccff,
    0xff8888,
    0x88ffaa,
    0xffcc66,
    0xcc99ff,
    0x66eecc,
    0xffaaee,
];

/**
 * Index into `PATRON_TINT_COLORS` for the blue outfit. This is the only
 * colour slot with a bespoke brewer-suit diffuse texture authored for it —
 * the local avatar and any remote peers using this slot swap their map
 * instead of multiplying the default diffuse by a tint, so the suit reads
 * as genuinely blue (not white-tinted-blue) for everyone in the lobby.
 */
export const BLUE_SUIT_COLOR_INDEX = 1;
