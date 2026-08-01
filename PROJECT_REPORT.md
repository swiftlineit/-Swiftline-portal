# Swiftline Portal Project Report

Date: 2026-07-07

## Executive Summary

Swiftline Portal is in a healthy early-stage state. The project is split into a backend API and frontend web app, both using TypeScript and modern frameworks. After review and cleanup, the current baseline builds successfully:

- Backend TypeScript build: passed
- Frontend ESLint: passed
- Frontend production build: passed

The base architecture is good enough to continue development, but a few items should be handled before the portal grows: typed Express auth context, stronger refresh-token/session handling, test setup, and removal or isolation of temporary debug scripts.

## Current Structure

```text
portal/
  backend/
    src/
      config/
      controllers/
      middleware/
      models/
      routes/
      services/
      app.ts
      server.ts
    package.json
    tsconfig.json
  frontend/
    src/
      app/
      components/
      lib/
    package.json
    next.config.ts
    tsconfig.json
  PROJECT_REPORT.md
```

## Backend Overview

Stack:

- Node.js with Express 5
- TypeScript using `NodeNext`
- MongoDB through Mongoose
- JWT authentication
- HTTP-only refresh-token cookie
- Zod environment validation
- Helmet, CORS, cookie parsing, request logging, and rate limiting

Implemented API areas:

- `GET /` API root
- `GET /api/v1/health`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/logout`
- `POST /api/v1/auth/refresh`
- `GET /api/v1/auth/me`
- `PATCH /api/v1/auth/welcome-seen`
- Admin-only user routes under `/api/v1/users`

Strengths:

- Clean separation between `app.ts` and `server.ts`
- Central environment validation in `config/env.ts`
- Strict TypeScript settings enabled
- Passwords are hashed with bcrypt
- Login lockout exists after repeated failed attempts
- Role-based route protection exists for admin user management

## Frontend Overview

Stack:

- Next.js 16 App Router
- React 19
- TypeScript
- Tailwind CSS 4
- React Icons

Implemented UI areas:

- Login page at `/`
- Redirect page at `/auth/login`
- Protected dashboard at `/dashboard`
- Sidebar component
- Welcome modal
- Access-token refresh helper

Strengths:

- Simple frontend API helper layer exists
- Auth token is kept in memory, while refresh token stays HTTP-only
- Dashboard attempts refresh before redirecting to login
- Production build is now independent from Google Font network fetches

## Package Inventory

Backend direct packages:

- Runtime: `bcrypt@5.1.1`, `cookie-parser@1.4.7`, `cors@2.8.6`, `dotenv@17.4.2`, `express@5.2.1`, `express-rate-limit@6.11.2`, `helmet@8.2.0`, `jsonwebtoken@9.0.3`, `mongoose@9.7.3`, `morgan@1.11.0`, `zod@4.4.3`
- Development/types: `typescript@6.0.3`, `tsx@4.23.0`, `@types/node@26.1.0`, `@types/express@5.0.6`, `@types/bcrypt@6.0.0`, `@types/cookie-parser@1.4.10`, `@types/cors@2.8.19`, `@types/jsonwebtoken@9.0.10`, `@types/morgan@1.9.10`

Frontend direct packages:

- Runtime: `next@16.2.10`, `react@19.2.4`, `react-dom@19.2.4`, `react-icons@5.7.0`
- Development/types: `typescript@5.9.3`, `eslint@9.39.4`, `eslint-config-next@16.2.10`, `tailwindcss@4.3.2`, `@tailwindcss/postcss@4.3.2`, `@types/node@20.19.43`, `@types/react@19.2.17`, `@types/react-dom@19.2.3`

## Fixes Applied During Review

- Mounted the existing backend `globalLimiter` middleware.
- Removed the public temporary `/api/v1/redis-test` endpoint from the main API.
- Fixed case-sensitive logo references from `/slogo.png` to `/Slogo.png`.
- Replaced plain logo `<img>` tags with Next `Image`.
- Cleaned frontend ESLint warnings.
- Added login button loading state and disabled behavior.
- Removed `next/font/google` dependency from the app layout to prevent production builds from failing when Google Fonts cannot be fetched.

## Validation Results

Commands run:

```bash
cd portal/backend && npm run build
cd portal/frontend && npm run lint
cd portal/frontend && npm run build
```

Results:

- Backend build passed.
- Frontend lint passed with zero warnings after cleanup.
- Frontend production build passed.

Initial frontend build failed because `next/font/google` could not fetch Geist fonts from Google. This has been fixed by using local/system font styling instead of network-fetched fonts.

## Architecture Risks To Address Next

1. Add typed Express request user context.
   Current auth middleware uses `req as any`. This is acceptable for a prototype but should be replaced with Express type augmentation before more protected routes are added.

2. Harden refresh-token sessions.
   Refresh tokens are currently signed with the same JWT secret and are not stored, rotated, or revocable server-side. For a production portal, use a separate refresh secret and store hashed refresh-token IDs in MongoDB so logout and compromise handling are reliable.

3. Add automated tests.
   Backend has no real test command yet. Add focused tests for login, refresh, role protection, lockout, and user admin routes. Add frontend tests later for auth redirects and dashboard behavior.

4. Move temporary scripts out of the package root.
   `debugPassword.js`, `inspectAdmin.js`, and `tmpAuthTest.js` should be removed, moved to a private scripts folder, or documented clearly so they are not shipped or accidentally used in production.

5. Add a root workspace setup.
   The project currently has separate backend and frontend packages. A root `package.json` with workspaces or scripts such as `dev`, `build`, and `lint` would make onboarding safer.

6. Add deployment environment documentation.
   Document required variables for backend and frontend, including `CLIENT_URL`, `MONGODB_URI`, `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and frontend `NEXT_PUBLIC_API_URL`.

7. Review CORS and cookies for production domain.
   `sameSite: "lax"` and secure production cookies are a good start, but production deployment should confirm frontend/backend domain relationships and HTTPS behavior.

## Recommended Next Milestone

Before adding major business features, complete this foundation milestone:

- Add root workspace scripts.
- Add backend test framework and first auth tests.
- Add Express request type augmentation.
- Split access and refresh token secrets.
- Store refresh sessions server-side.
- Remove or quarantine temporary backend debug scripts.
- Add `.env.example` for frontend with `NEXT_PUBLIC_API_URL`.

After those are done, the base architecture will be much safer for shipment tracking, customer accounts, staff workflows, and admin screens.
