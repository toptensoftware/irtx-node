// demo-recv.js — UDP receiver for IR codes forwarded by an irtx device
//
// Listens on the same port as the irtx firmware (4210) and decodes
// cmd=4 packets (IR code transmit) sent by the router when dstIp is
// set to this machine's IP address.
//
// Usage: node demo-recv.js [port]

import dgram   from 'dgram';
import os      from 'os';

const UDP_PORT = Number(process.argv[2]) || 4210;

// ---- Get own IP address -------------------------------------------------------

function getOwnIp() {
    for (const iface of Object.values(os.networkInterfaces())) {
        for (const addr of iface) {
            if (addr.family === 'IPv4' && !addr.internal)
                return addr.address;
        }
    }
    return '127.0.0.1';
}

const MY_IP = getOwnIp();
console.log(`Own IP: ${MY_IP}`);

// ---- RIFF protocol ID helpers ------------------------------------------------

function riff(a, b, c, d) {
    return (a.charCodeAt(0))        |
           (b.charCodeAt(0) << 8)   |
           (c.charCodeAt(0) << 16)  |
           (d.charCodeAt(0) << 24);
}

const KNOWN_PROTOCOLS = {
    [riff('N','E','C',' ')]: 'NEC',
    [riff('P','A','N','A')]: 'PANA',
};

function protocolName(id) {
    return KNOWN_PROTOCOLS[id >>> 0] ?? `0x${(id >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
}

function riffToString(id) {
    // Decode the four ASCII bytes back to a printable tag for display
    return [id, id >> 8, id >> 16, id >> 24]
        .map(b => { const c = b & 0xFF; return c >= 0x20 && c < 0x7F ? String.fromCharCode(c) : '?'; })
        .join('');
}

// ---- Packet parsing ----------------------------------------------------------
//
// cmd=4 layout (17 bytes, all little-endian):
//   [uint16 cmd=4][uint16 devIdx][uint32 protocol][uint64 code][uint8 repeat]

function parseCmd4(buf, rinfo) {
    if (buf.length < 17) return null;

    const cmd      = buf.readUInt16LE(0);
    if (cmd !== 4) return null;

    const devIdx   = buf.readUInt16LE(2);
    const protocol = buf.readUInt32LE(4);
    const codeLo   = buf.readUInt32LE(8);
    const codeHi   = buf.readUInt32LE(12);
    const code     = (BigInt(codeHi) << 32n) | BigInt(codeLo);
    const repeat   = buf.readUInt8(16);

    return { cmd, devIdx, protocol, code, repeat };
}

// ---- UDP Server --------------------------------------------------------------

const sock = dgram.createSocket('udp4');

sock.on('error', (err) => {
    console.error('Socket error:', err.message);
    sock.close();
});

sock.on('message', (buf, rinfo) => {
    if (buf.length < 2) return;

    const cmd = buf.readUInt16LE(0);

    if (cmd === 4) {
        const pkt = parseCmd4(buf, rinfo);
        if (!pkt) {
            console.warn(`[${rinfo.address}] cmd=4 but packet too short (${buf.length} bytes)`);
            return;
        }

        const proto = protocolName(pkt.protocol);
        const tag   = riffToString(pkt.protocol);
        const code  = pkt.code.toString(16).toUpperCase().padStart(16, '0');
        const rep   = pkt.repeat ? ' (repeat)' : '';

        console.log(
            `[${rinfo.address}] IR code  dev=${pkt.devIdx}  ` +
            `protocol=${proto} (${tag})  code=0x${code}${rep}`
        );

        // ---- Handle the IR code here ----
        // e.g. onIrCode(pkt.protocol, pkt.code, pkt.repeat);

    } else {
        console.log(`[${rinfo.address}] cmd=${cmd} (${buf.length} bytes) — unhandled`);
    }
});

sock.on('listening', () => {
    const { address, port } = sock.address();
    console.log(`Listening on ${address}:${port}`);
});

sock.bind(UDP_PORT);
