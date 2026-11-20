# Shatter

Shatter is a DX-Ball-style brick breaker with a hand-drawn look, built for phones first (portrait).
It is a Vite + TypeScript game drawn on a Canvas 2D, with no game framework, and ships as an
installable PWA. See `PLAN.md` for the design and milestones.

## Commands

```sh
npm install      # install dependencies
npm run dev      # start the dev server
npm test         # run the unit tests (Vitest)
npm run build    # type-check (tsc --noEmit) and build to dist/
npm run preview  # serve the built dist/ locally
```

## Deploy

Deploys to GitHub Pages through `.github/workflows/deploy.yml`, which runs on pushes to `main`.
In the repository settings, set Settings > Pages > Source to "GitHub Actions".
