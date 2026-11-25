/** A zip with no compression ("stored"): enough to hand out a folder of small text files. */

const CRC_TABLE = (() => {
	const t = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		t[n] = c >>> 0;
	}
	return t;
})();

function crc32(buf: Uint8Array): number {
	let c = 0xffffffff;
	for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

export function zip(files: { name: string; data: Buffer }[]): Buffer {
	const local: Buffer[] = [];
	const central: Buffer[] = [];
	let offset = 0;
	// 1980-01-01 00:00, the zip epoch: the same bytes on every download.
	const dosTime = 0;
	const dosDate = (0 << 9) | (1 << 5) | 1;
	for (const f of files) {
		const name = Buffer.from(f.name, 'utf8');
		const crc = crc32(f.data);
		const head = Buffer.alloc(30);
		head.writeUInt32LE(0x04034b50, 0);
		head.writeUInt16LE(20, 4);
		head.writeUInt16LE(0x0800, 6); // UTF-8 names
		head.writeUInt16LE(0, 8); // stored
		head.writeUInt16LE(dosTime, 10);
		head.writeUInt16LE(dosDate, 12);
		head.writeUInt32LE(crc, 14);
		head.writeUInt32LE(f.data.length, 18);
		head.writeUInt32LE(f.data.length, 22);
		head.writeUInt16LE(name.length, 26);
		local.push(head, name, f.data);

		const dir = Buffer.alloc(46);
		dir.writeUInt32LE(0x02014b50, 0);
		dir.writeUInt16LE(0x031e, 4); // made by: unix
		dir.writeUInt16LE(20, 6);
		dir.writeUInt16LE(0x0800, 8);
		dir.writeUInt16LE(0, 10);
		dir.writeUInt16LE(dosTime, 12);
		dir.writeUInt16LE(dosDate, 14);
		dir.writeUInt32LE(crc, 16);
		dir.writeUInt32LE(f.data.length, 20);
		dir.writeUInt32LE(f.data.length, 24);
		dir.writeUInt16LE(name.length, 28);
		dir.writeUInt32LE((0o100644 << 16) >>> 0, 38); // -rw-r--r--
		dir.writeUInt32LE(offset, 42);
		central.push(dir, name);
		offset += head.length + name.length + f.data.length;
	}
	const cd = Buffer.concat(central);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(files.length, 8);
	end.writeUInt16LE(files.length, 10);
	end.writeUInt32LE(cd.length, 12);
	end.writeUInt32LE(offset, 16);
	return Buffer.concat([...local, cd, end]);
}
