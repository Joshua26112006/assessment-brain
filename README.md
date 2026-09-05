# Assessment Brain

A dummy application for schools where teachers can upload question papers, generate AI-assisted rubrics with multiple valid solution approaches, publish assessments to students, evaluate student answer sheets, annotate verified errors, and calculate marks.

This repository currently contains only the application shell (scaffolding, routing, and shared types). The intelligence pipeline (question understanding, rubric generation, answer reading, correction, novel-approach handling, annotation, grading) is not yet implemented.

## Stack

- [Next.js](https://nextjs.org) (App Router)
- TypeScript
- Tailwind CSS

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Project structure

```
src/
  app/            Routes (Teacher and Student sections)
  components/     Shared UI components
  lib/            Pipeline logic, organized by stage (currently placeholders)
  types/          Shared foundational types
```
