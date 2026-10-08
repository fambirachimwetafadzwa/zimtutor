import { config } from "zod/v4/core";

// Runs in the browser before the page becomes interactive.
//
// Schemas can compile themselves into faster code, and to find out whether that is possible they try
// `eval`. The Content Security Policy does not allow `eval`, so the browser would report a refusal on
// every page that checks something. Checking works the same without compiling, and a page's few
// checks do not need the speed.
config({ jitless: true });
