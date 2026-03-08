// demo.js — Send an IR routing table to an irtx device via UDP (cmd=5)
//
// Usage: node demo.js [device-ip]
//
// Packet layout:
//   [uint16 cmd=5][uint16 count][entry × count]
// Each entry (28 bytes, all little-endian):
//   [uint32 srcProtocol][uint64 srcCode][uint32 dstProtocol][uint64 dstCode][uint32 dstIp]
//
// dstIp: little-endian uint32, first octet in LSB.
//   e.g. 192.168.1.50 → bytes [192, 168, 1, 50]
// dstProtocol == 0       → suppress
// dstIp       == 0.0.0.0 → retransmit locally

import dgram from 'dgram';
import os      from 'os';

const DEVICE_IP = "10.1.1.101";
const UDP_PORT  = 4210;

// RIFF-style 4-byte protocol IDs (little-endian ASCII)
const PROTOCOL_NEC  = riff('N', 'E', 'C', ' ');
const PROTOCOL_PANA = riff('P', 'A', 'N', 'A');

function riff(a, b, c, d) {
    return (a.charCodeAt(0)) |
           (b.charCodeAt(0) << 8) |
           (c.charCodeAt(0) << 16) |
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




function writeIPv4(buf, offset, ip) {
    const parts = ip.split('.');
    buf[offset]     = parseInt(parts[0]);
    buf[offset + 1] = parseInt(parts[1]);
    buf[offset + 2] = parseInt(parts[2]);
    buf[offset + 3] = parseInt(parts[3]);
}

// Write a uint64 into a Buffer at offset (as two uint32 LE halves)
function writeU64LE(buf, offset, value) {
    // value may be a BigInt or a regular number
    const big = BigInt(value);
    buf.writeUInt32LE(Number(big & 0xFFFFFFFFn), offset);
    buf.writeUInt32LE(Number(big >> 32n),        offset + 4);
}

// Build the cmd=5 packet for the given array of route objects:
//   { srcProtocol, srcCode, dstProtocol, dstCode, dstIp }
// srcCode / dstCode: BigInt or number (64-bit IR code)
// dstIp: IP string, or '0.0.0.0' for local retransmit
// dstProtocol: 0 to suppress
function buildRoutePacket(routes) {
    const ENTRY_SIZE = 28;
    const buf = Buffer.alloc(4 + routes.length * ENTRY_SIZE);
    buf.writeUInt16LE(5,             0);  // cmd
    buf.writeUInt16LE(routes.length, 2);  // count

    let offset = 4;
    for (const r of routes) {
        buf.writeUInt32LE(r.srcProtocol,       offset);      offset += 4;
        writeU64LE(buf, offset, r.srcCode);                  offset += 8;
        buf.writeUInt32LE(r.dstProtocol ?? 0,  offset);      offset += 4;
        writeU64LE(buf, offset, r.dstCode ?? 0n);            offset += 8;
        writeIPv4(buf, offset, r.dstIp ?? '0.0.0.0');       offset += 4;
    }

    return buf;
}

// ---- Get own IP address -------------------------------------------------------
// Use this value in your routing table's dstIp so the irtx device forwards
// matched IR codes here instead of (or in addition to) retransmitting via IR.

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


function setupRoutingTable(routes)
{
    // ---- Send ----

    const packet = buildRoutePacket(routes);
    const sock   = dgram.createSocket('udp4');

    sock.send(packet, UDP_PORT, DEVICE_IP, (err) => {
        sock.close();
        if (err) {
            console.error('Send failed:', err.message);
            process.exit(1);
        }
        console.log(`Sent ${routes.length} route(s) (${packet.length} bytes) to ${DEVICE_IP}:${UDP_PORT}`);
        for (const r of routes) {
            const src = `0x${r.srcCode.toString(16).toUpperCase().padStart(16, '0')}`;
            if (!r.dstProtocol) {
                console.log(`  suppress  ${r.srcIp ?? ''}  ${src}`);
            } else if (!r.dstIp || r.dstIp === '0.0.0.0') {
                const dst = `0x${r.dstCode.toString(16).toUpperCase().padStart(16, '0')}`;
                console.log(`  local TX  ${src}  →  ${dst}`);
            } else {
                const dst = `0x${r.dstCode.toString(16).toUpperCase().padStart(16, '0')}`;
                console.log(`  remote TX ${src}  →  ${r.dstIp}  ${dst}`);
            }
        }
    });

}

setupRoutingTable([
    // Map NEC to self
    {
        srcProtocol: PROTOCOL_PANA,
        srcCode:     0x000040040D084144n,       // Pana OK button
        dstProtocol: PROTOCOL_PANA,
        dstCode:     0x000040040D084144n,
        dstIp:       MY_IP,      // local
    },
]);


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
