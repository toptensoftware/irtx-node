// demo.js — Send a switch-activity command to an irtx device via UDP (cmd=5)
//
// Usage: node demo.js [device-ip [activity-index]]
//
// Packet layout:
//   [uint16 cmd=5][uint32 activityIndex]   (6 bytes total, little-endian)

import dgram from 'dgram';

const DEVICE_IP      = process.argv[2] ?? "10.1.1.101";
const ACTIVITY_INDEX = Number(process.argv[3] ?? 0);
const UDP_PORT       = 4210;

function buildSwitchActivityPacket(index) {
    const buf = Buffer.alloc(6);
    buf.writeUInt16LE(5,     0);  // cmd
    buf.writeUInt32LE(index, 2);  // activityIndex
    return buf;
}

const packet = buildSwitchActivityPacket(ACTIVITY_INDEX);
const sock   = dgram.createSocket('udp4');

sock.send(packet, UDP_PORT, DEVICE_IP, (err) => {
    sock.close();
    if (err) {
        console.error('Send failed:', err.message);
        process.exit(1);
    }
    console.log(`Sent switch-activity (index=${ACTIVITY_INDEX}) to ${DEVICE_IP}:${UDP_PORT}`);
});
