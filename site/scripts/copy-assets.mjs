// Copies the logo files and the docs pictures into public/, so the site uses
// the same files as the README instead of keeping copies of its own.
import { cpSync, rmSync } from 'node:fs';

const from = (path) => new URL(`../../${path}`, import.meta.url);
const to = (path) => new URL(`../public/${path}`, import.meta.url);

for (const folder of ['brand', 'media']) rmSync(to(folder), { recursive: true, force: true });
cpSync(from('brand'), to('brand'), { recursive: true });
cpSync(from('docs/media'), to('media'), { recursive: true });
