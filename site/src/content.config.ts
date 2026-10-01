import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';

// The documentation is the Markdown in ../docs, the same files GitHub shows.
const docs = defineCollection({
  loader: glob({ pattern: '*.md', base: '../docs' }),
});

export const collections = { docs };
