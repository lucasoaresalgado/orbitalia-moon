#!/usr/bin/env node
// The CLI runs its TypeScript source through tsx, like the worker.
import { register } from "tsx/esm/api";

register();
await import("../src/main.ts");
