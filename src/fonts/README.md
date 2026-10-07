# Bundled prompt fonts

Geist Variable is distributed unchanged from the official Vercel Geist repository, pinned to v1.7.2.

- Source: https://github.com/vercel/geist-font/tree/v1.7.2
- Font: https://raw.githubusercontent.com/vercel/geist-font/v1.7.2/packages/next/dist/fonts/geist-sans/Geist-Variable.woff2
- License: `OFL-Geist.txt` (SIL Open Font License 1.1)
- SHA-256: `2FFEBE993E969069A9789D15164B7715D42491B5835516C5E3B935D5F81B05F1`

No online font service or operating-system font installation is required. Missing glyphs use the existing default prompt font stack. The default option retains the existing system fonts; those system fonts are not redistributed.

To add a font, put its font file and redistribution license in this directory, register its family, file, format and weight in `src/typography.cjs`, then run `node scripts/build.cjs`. The font selector and `@font-face` declarations are generated automatically.
