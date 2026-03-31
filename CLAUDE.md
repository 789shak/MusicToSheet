# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## IMPORTANT: Active Project

**Always work in `C:\Users\altafhussain\Desktop\MusicToSheet`.**
Never edit files in `C:\Users\altafhussain\SheetMusicApp` — that is an old, abandoned project.

## App Overview

**Music-To-Sheet** — converts audio/music recordings into sheet music. Domain: musictosheet.com.

**Theme:** Dark mode — charcoal black background (`#111118`), turquoise accents (`#0EA5E9`), white text (`#FFFFFF`).

## Commands

```bash
npm start              # Start Expo dev server (choose platform interactively)
npm run android        # Start on Android emulator/device
npm run ios            # Start on iOS simulator (macOS only)
npm run web            # Start in browser
npm run lint           # Run ESLint via expo lint
npm run reset-project  # Move starter code to app-example/, reset app/ to blank
```

## Architecture

This is an **Expo Router** (file-based routing) project using **React Native** with TypeScript strict mode.

### Routing

Routes live in `app/`. Expo Router maps the file system to navigation routes:
- `app/_layout.tsx` — root layout, wraps everything in `ThemeProvider` + `Stack`
- `app/(tabs)/` — tab group with bottom tab navigator
- New screens go in `app/` or nested groups; `src/screens/` holds placeholder components that are imported by route files

### Path Aliases

`@/` maps to the project root (configured in `tsconfig.json`). Use `@/components/...`, `@/hooks/...`, `@/src/...`, etc.

### Theming

- `constants/theme.ts` — exports `Colors` (light/dark palettes) and `Fonts` (platform-specific font stacks)
- App theme: `#111118` background, `#0EA5E9` accents, `#FFFFFF` text — override the default `Colors` values here
- `hooks/use-color-scheme.ts` / `use-color-scheme.web.ts` — platform-split hook for detecting color scheme
- `hooks/use-theme-color.ts` — resolves a color token against the active scheme

### Project Structure (planned)

```
src/
  screens/    # 12 screen placeholder components (imported by app/ routes)
  lib/        # Configs, API clients, utilities
  hooks/      # Custom hooks (beyond theming)
  components/ # Shared UI components
components/   # Expo-generated shared components (ThemedText, ThemedView, etc.)
constants/    # Theme tokens
hooks/        # Theming hooks (Expo-generated)
app/          # File-based routes (Expo Router)
```

### Screen List

`OnboardingScreen`, `LoginScreen` (initial route), `SubscriptionScreen`, `UploadScreen`, `RightsDeclarationScreen`, `ProcessingScreen`, `ResultsScreen`, `HistoryScreen`, `PublicDomainLibraryScreen`, `SettingsScreen`, `ProfileScreen`, `DeleteAccountScreen`
