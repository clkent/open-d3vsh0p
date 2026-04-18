# Tech Stack Bootstrap

You are setting up the tech stack for a newly created project. The project has specs, a roadmap, and a conventions file — but no dependencies installed and no config files created. Your job is to make the project build-ready.

## Project Context

- Project ID: {{PROJECT_ID}}
- Project Directory: {{PROJECT_DIR}}

## CRITICAL: File Paths

You are operating in: **{{PROJECT_DIR}}**

All changes MUST be inside this directory. Do NOT modify files outside it.

## What To Do

1. **Read the tech stack specifications**
   - Read `openspec/conventions.md` — this is your source of truth for which tools, frameworks, and patterns to use
   - Read `openspec/project.md` — this gives you the project overview and tech stack summary

2. **Install all dependencies**
   - Install every dependency implied by the conventions (framework, testing, styling, types, ORM, auth, etc.)
   - Use `npm install` for runtime deps and `npm install -D` for dev deps
   - Install specific versions when conventions mention them (e.g., "Jest 30" → `jest@30`)
   - Include TypeScript type packages where appropriate (`@types/node`, `@types/react`, etc.)

3. **Create configuration files**
   Based on what the conventions specify, create the config files the stack requires. Common ones:
   - `tsconfig.json` — if TypeScript is used
   - `postcss.config.js` — if Tailwind CSS is used (with `tailwindcss` and `autoprefixer` plugins)
   - `tailwind.config.js` — if Tailwind CSS is used (with content paths matching project structure)
   - `jest.config.js` or `jest.config.ts` — if Jest is used
   - `.eslintrc.json` — if ESLint is used
   - `next.config.js` — if Next.js is used
   - `prisma/schema.prisma` — if Prisma is used (minimal valid schema with the right datasource)
   - Any other config files the chosen stack requires

4. **Wire up package.json scripts**
   Make sure `package.json` has correct scripts:
   - `dev` — start the development server (e.g., `next dev`, `node src/index.js`)
   - `build` — production build (e.g., `next build`, `tsc`)
   - `test` — run the test suite (e.g., `jest`, `vitest`)
   - `lint` — run the linter (e.g., `next lint`, `eslint .`)
   - Any ORM-specific scripts (e.g., `db:generate`, `db:push` for Prisma)

5. **Create a minimal smoke test**
   Create one simple test file so `npm test` has something to pass:
   - Use the testing framework specified in conventions
   - Place it in the test location specified in conventions
   - A single test like `it('smoke test', () => { expect(true).toBe(true) })` is sufficient
   - This validates the test runner is properly configured

6. **Create minimal app entry point** (if the framework needs one)
   - For Next.js: ensure `src/app/layout.tsx` and `src/app/page.tsx` exist with minimal content
   - For Express: ensure the entry point file exists
   - Only create what's needed for `npm run build` to succeed

7. **Verify the setup**
   - Run `npm run build` — it must exit successfully
   - Run `npm test` — it must exit successfully
   - If either fails, fix the issue and retry

## Guidelines

- Follow conventions.md exactly — if it says "Jest 30", use Jest 30, not Vitest
- If conventions.md doesn't specify a version, use the latest stable version
- Do NOT write any feature code — only setup, config, and the smoke test
- Do NOT modify openspec files (specs, roadmap, conventions, project.md)
- Do NOT create sample/example components — just the minimum for build to pass
- Keep everything consistent: if conventions say "ES Modules", make sure configs use ES module syntax where appropriate
