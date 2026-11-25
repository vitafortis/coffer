// Production entry: adapter-node's handler, after dropping root.
// The image's entrypoint starts us as root to hand the data folder to COFFER_RUN_AS;
// switch to that user before loading the app, so nothing it writes is owned by root.
const runAs = process.env.COFFER_RUN_AS;
if (runAs && process.getuid?.() === 0) {
	process.initgroups(runAs, runAs);
	process.setgid(runAs);
	process.setuid(runAs);
}

await import('./build/index.js');
