// Clipboard access for the background worker (which has none of its own).
const t = document.getElementById('t');

function write(value) {
	// A copy handler sets the data directly, so an empty string really empties the clipboard.
	const onCopy = (e) => {
		e.clipboardData.setData('text/plain', value);
		e.preventDefault();
	};
	document.addEventListener('copy', onCopy, { once: true });
	t.focus();
	document.execCommand('copy');
}

function read() {
	t.value = '';
	t.focus();
	document.execCommand('paste');
	const v = t.value;
	t.value = '';
	return v;
}

async function sha256(s) {
	const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
	return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
	if (msg?.target !== 'offscreen') return;
	(async () => {
		if (msg.type === 'copy') write(msg.value);
		// Only clear what Coffer put there: if you copied something else since, leave it.
		if (msg.type === 'clear-if' && (await sha256(read())) === msg.hash) write('');
		reply(true);
	})();
	return true;
});
