import { serverUrl } from '#lib/server/assets.ts';
import type { RequestHandler } from './$types';

/** curl -fsSL <coffer>/cli/install.sh | sh — puts the CLI in ~/.local/bin (or $COFFER_BIN). */
export const GET: RequestHandler = ({ locals }) => {
	const url = serverUrl(locals.origin);
	const script = `#!/bin/sh
# Installs the Coffer CLI from ${url}
set -eu
command -v node >/dev/null 2>&1 || { echo "coffer needs Node.js 20 or later: https://nodejs.org" >&2; exit 1; }
major=$(node -p 'process.versions.node.split(".")[0]')
[ "$major" -ge 20 ] || { echo "coffer needs Node.js 20 or later (found $(node -v))" >&2; exit 1; }
bin="\${COFFER_BIN:-$HOME/.local/bin}"
mkdir -p "$bin"
tmp="$(mktemp)"
curl -fsSL '${url}/cli/coffer' -o "$tmp"
chmod 755 "$tmp"
mv "$tmp" "$bin/coffer"
echo "Installed $bin/coffer"
case ":$PATH:" in *":$bin:"*) ;; *) echo "Add it to your PATH: export PATH=\\"$bin:\\$PATH\\"" ;; esac
echo "Next: coffer login"
`;
	return new Response(script, { headers: { 'content-type': 'text/x-shellscript; charset=utf-8', 'cache-control': 'no-cache' } });
};
