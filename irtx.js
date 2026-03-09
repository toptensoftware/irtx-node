import dgram from "node:dgram";
import os from "node:os";
import dns from "node:dns/promises";
import { EventEmitter } from "node:events";

const commandSendIr = 1;
const commandBleConnect = 2;
const commandBleSendHid = 3;
const commandSendIrCode = 4;
const commandSetRoutingTable = 5;

/**
 * Encodes a 4-character ASCII string as a little-endian 32-bit RIFF FourCC integer.
 * @param {string} a - A string of up to 4 characters (padded with spaces if shorter).
 * @returns {number} The FourCC value as a 32-bit integer.
 */
export function riff(a)
{
    if (typeof(a) === "string")
    {
        while (a.length < 4)
            a = a + " ";

        return (a.charCodeAt(0)) |
            (a.charCodeAt(1) << 8) |
            (a.charCodeAt(2) << 16) |
            (a.charCodeAt(3) << 24);
    }
    throw new Error("Invalid riff value");
}

/**
 * @param {Buffer} buf
 * @param {string} ip
 * @param {number} offset
 */
function writeIPv4(buf, ip, offset)
{
    const parts = ip.split('.');
    buf[offset]     = parseInt(parts[0]);
    buf[offset + 1] = parseInt(parts[1]);
    buf[offset + 2] = parseInt(parts[2]);
    buf[offset + 3] = parseInt(parts[3]);
}

/**
 * @param {Buffer} buf
 * @param {bigint | number} value
 * @param {number} offset
 */
function writeU64LE(buf, value, offset)
{
    const big = BigInt(value);
    buf.writeUInt32LE(Number(big & 0xFFFFFFFFn), offset);
    buf.writeUInt32LE(Number(big >> 32n),        offset + 4);
}

const ipv4Re = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * Returns the most likely local-network IPv4 address for this machine.
 * Prefers RFC-1918 private ranges (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
 * over other addresses. Returns '127.0.0.1' if nothing better is found.
 * @returns {string}
 */
/*
function getLocalNetworkIp()
{
    const candidates = [];
    for (const ifaces of Object.values(os.networkInterfaces()))
    {
        for (const iface of ifaces)
        {
            if (iface.family !== "IPv4" || iface.internal)
                continue;
            const [a, b] = iface.address.split('.').map(Number);
            const isPrivate = a === 10 ||
                              (a === 172 && b >= 16 && b <= 31) ||
                              (a === 192 && b === 168);
            candidates.push({ address: iface.address, isPrivate });
        }
    }
    candidates.sort((a, b) => b.isPrivate - a.isPrivate);
    return candidates[0]?.address ?? '127.0.0.1';
}
*/

/**
 * BLE HID report ID constants.
 * @type {{ keyboard: 1, consumer: 2, mouse: 3 }}
 */
export const irtxHidReportId = {
    keyboard: 1,
    consumer: 2,
    mouse: 3,
}

const VIRTUAL_IFACE_PATTERNS = [/vmware/i, /virtualbox/i, /vethernet/i, /vmnet/i, /vbox/i];
const PREFERRED_IFACE_PATTERNS = [/^wi.?fi$/i, /^ethernet$/i, /^eth\d/i, /^en\d/i, /^wlan\d/i];

let local_ip;
function getLocalIp() 
{
    if (local_ip)
        return local_ip;

    const candidates = [];

    for (const [name, iface] of Object.entries(os.networkInterfaces())) {
        for (const addr of iface) {
            if (addr.family !== 'IPv4' || addr.internal)
                continue;

            const isVirtual = VIRTUAL_IFACE_PATTERNS.some(p => p.test(name));
            const isPreferred = PREFERRED_IFACE_PATTERNS.some(p => p.test(name));

            candidates.push({ address: addr.address, isVirtual, isPreferred });
        }
    }

    // Sort: preferred first, virtual last
    candidates.sort((a, b) => {
        if (a.isPreferred !== b.isPreferred) return a.isPreferred ? -1 : 1;
        if (a.isVirtual !== b.isVirtual) return a.isVirtual ? 1 : -1;
        return 0;
    });

    return local_ip = candidates[0]?.address ?? null;
}

/**
 * @typedef {Object} IrSendOpts
 * @property {number} [deviceIndex=0] - IR transmitter index on the device.
 * @property {number} [carrierFrequency=38000] - Carrier frequency in Hz (raw timing mode only).
 * @property {boolean} [repeat=false] - Whether to send as a repeat frame (protocol mode only).
 */

/**
 * @typedef {Object} IrCode
 * @property {string | number} protocol - Protocol name (e.g. `"NEC"`) or FourCC number.
 * @property {string | number | bigint} code - IR code value (hex string or number).
 * @property {boolean} [repeat=false] - Whether to send as a repeat frame.
 */

/**
 * @typedef {Object} RoutingEntry
 * @property {string | number} srcProtocol - Source protocol name (e.g. `"NEC"`) or FourCC number.
 * @property {bigint | number} srcCode - Source IR code (64-bit).
 * @property {string | number} [dstProtocol=0] - Destination protocol name or FourCC number, or 0 to suppress retransmit.
 * @property {bigint | number} [dstCode=0n] - Destination IR code (64-bit).
 * @property {string} [dstIp='0.0.0.0'] - Destination IP, or `'0.0.0.0'` for local retransmit.
 */

/**
 * Represents a connection to a single irtx UDP device.
 *
 * @example
 * const irtx = new IrtxDevice("192.168.1.100");
 * await irtx.irSend("NEC:0x20DF10EF");
 * irtx.close();
 *
 * @fires IrtxDevice#ircode
 */
export class IrtxDevice extends EventEmitter
{
    /**
     * Opens a UDP connection to an irtx device.
     * @param {string} ipaddress - IP address or hostname of the device.
     * @param {number} [port=4210] - UDP port number.
     */
    constructor(ipaddress, port = 4210)
    {
        super();
        this._ip = ipaddress;
        this._port = port;
        this._sock = dgram.createSocket("udp4");
        this._listenSock = null;
        this._dnsCache = new Map();
    }

    /**
     * Closes the UDP socket and releases the device connection.
     * @returns {void}
     */
    close()
    {
        this.stopListening();
        if (this._sock)
        {
            this._sock.close();
            this._sock = null;
        }
    }

    /**
     * Starts listening for incoming cmd 4 (IR code) UDP packets on the specified port.
     * Emits an `'ircode'` event for each valid packet received.
     *
     * @fires IrtxDevice#ircode
     * @param {number} [port=4210] - UDP port to listen on.
     * @returns {Promise<void>} Resolves when the socket is bound and listening.
     *
     * @example
     * irtx.on('ircode', ({ protocol, code, deviceIndex, repeat }) => {
     *     console.log(`Received IR code: protocol=0x${protocol.toString(16)} code=0x${code.toString(16)}`);
     * });
     * await irtx.startListening();
     */
    startListening(port = 4210)
    {
        if (this._listenSock)
            return Promise.resolve();

        return new Promise((resolve, reject) =>
        {
            const sock = dgram.createSocket("udp4");

            sock.on("error", (err) =>
            {
                this.emit("error", err);
            });

            sock.on("message", (msg, rinfo) =>
            {
                if (msg.length < 17)
                    return;

                const cmd = msg.readUInt16LE(0);
                if (cmd !== commandSendIrCode)
                    return;

                const deviceIndex = msg.readUInt16LE(2);
                const protocol    = msg.readUInt32LE(4);
                const codeLo      = BigInt(msg.readUInt32LE(8));
                const codeHi      = BigInt(msg.readUInt32LE(12));
                const code        = (codeHi << 32n) | codeLo;
                const repeat      = msg.readUInt8(16) !== 0;

                /**
                 * Fired when a cmd 4 (IR code) UDP packet is received.
                 * @event IrtxDevice#ircode
                 * @type {Object}
                 * @property {number}  deviceIndex - IR device index from the packet.
                 * @property {number}  protocol    - FourCC protocol identifier.
                 * @property {bigint}  code        - 64-bit IR code value.
                 * @property {boolean} repeat      - Whether this is a repeat frame.
                 * @property {string}  remoteAddress - IP address of the sender.
                 * @property {number}  remotePort    - UDP port of the sender.
                 */
                this.emit("ircode", { deviceIndex, protocol, code, repeat, remoteAddress: rinfo.address, remotePort: rinfo.port });
            });

            sock.bind(port, () =>
            {
                this._listenSock = sock;
                resolve();
            });

            sock.once("error", reject);
        });
    }

    /**
     * Stops listening for incoming UDP packets and closes the listen socket.
     * @returns {void}
     */
    stopListening()
    {
        if (this._listenSock)
        {
            this._listenSock.close();
            this._listenSock = null;
        }
    }

    /**
     * Sends a raw UDP packet to the device.
     * @param {Buffer | number[]} pkt - Packet data as a Buffer or array of byte values.
     * @returns {Promise<void>}
     */
    sendPacket(pkt)
    {
        if (Array.isArray(pkt))
        {
            pkt = Buffer.from(pkt);
        }

        console.log(pkt);

        return new Promise((resolve, reject) =>
        {
            this._sock.send(pkt, this._port, this._ip, (err) =>
            {
                if (err)
                    reject(err)
                else
                {
                    console.log(`Sent ${pkt.length} bytes to ${this._ip}:${this._port}`);
                    resolve();
                }
            });
        });
    }

    /**
     * Sends an IR signal.
     *
     * Accepts three formats for `data`:
     * - `number[]` — raw timing data in microseconds (mark/space pairs, last entry is the trailing gap)
     * - `string` — `"PROTOCOL:CODE"` shorthand, e.g. `"NEC:0x20DF10EF"`
     * - `IrCode` — object with `protocol` and `code` properties
     *
     * @param {number[] | string | IrCode} data - IR data to send.
     * @param {IrSendOpts} [opts] - Optional send options.
     * @returns {Promise<void>}
     */
    irSend(data, opts)
    {
        // Resolve options
        opts = Object.assign({
            deviceIndex: 0,
            carrierFrequency: 38000,
            repeat: false
        }, opts);

        // String in format "PROT:CODE" (e.g. "NEC:0x20DF10EF")
        if (typeof(data) === "string")
        {
            let parts = data.split(":");
            if (parts.length == 2)
            {
                let protocol = parts[0];
                let code = parts[1];
                data = { protocol, code };
            }
        }

        // Object with protocol and code properties (e.g. { protocol: "NEC", code: "0x20DF10EF" })
        if (typeof(data) === "object" && data.protocol !== undefined && data.code !== undefined)
        {
            // Merge
            data = Object.assign({}, data, opts);

            // Normalize protocol
            let protocol = data.protocol;
            if (typeof(protocol) === "string")
                protocol = riff(data.protocol);

            // Normalize code
            let code = data.code;
            if (!code.startsWith("0x") && !code.startsWith("0X"))
                code = "0x" + code;
            code = BigInt(code);

            // Setup packet
            const packet = Buffer.alloc(17);
            packet.writeUInt16LE(commandSendIrCode, 0);
            packet.writeUInt16LE(data.deviceIndex ?? 0, 2);
            packet.writeUInt32LE(protocol, 4);
            writeU64LE(packet, code, 8);
            packet.writeUInt8(data.repeat ? 1 : 0, 16);

            return this.sendPacket(packet);
        }

        if (Array.isArray(data))
        {
            // Last entry is the trailing gap
            let gap = data[data.length - 1];

            // Build packet header
            const packet = Buffer.alloc(12 + (data.length - 1) * 2);
            packet.writeUInt16LE(commandSendIr, 0);
            packet.writeUInt16LE(opts.deviceIndex, 2);
            packet.writeUInt32LE(opts.carrierFrequency, 4);
            packet.writeUInt32LE(gap, 8);

            // Timing data (all entries except the trailing gap)
            for (let i = 0; i < data.length - 1; i++)
            {
                packet.writeUInt16LE(data[i], 12 + i * 2);
            }

            return this.sendPacket(packet);
        }

        throw new Error("Invalid send parameters");
    }

    /**
     * Resolves a hostname or IP string to a dotted-decimal IPv4 address.
     * Results are cached for the lifetime of the device instance.
     * `"localhost"` resolves to the machine's local-network IP (not 127.0.0.1).
     * @param {string} host
     * @returns {Promise<string>}
     */
    async _resolveIp(host)
    {
        if (!host || host === '0.0.0.0')
            return '0.0.0.0';

        if (host === 'localhost')
            return getLocalIp();

        if (ipv4Re.test(host))
            return host;

        if (this._dnsCache.has(host))
            return this._dnsCache.get(host);

        const { address } = await dns.lookup(host, { family: 4 });
        this._dnsCache.set(host, address);
        return address;
    }

    /**
     * Uploads the IR routing table to the device. Each entry maps an incoming IR code
     * to an outgoing IR code sent to a target IP (or retransmitted locally).
     *
     * `dstIp` accepts a dotted-decimal IP address, a hostname (resolved via DNS and
     * cached), or `"localhost"` (resolved to the machine's local-network IP).
     *
     * @param {RoutingEntry[]} table - Array of routing entries.
     * @returns {Promise<void>}
     */
    async setRoutingTable(table)
    {
        const resolvedIps = await Promise.all(table.map(r => this._resolveIp(r.dstIp ?? '0.0.0.0')));

        const ENTRY_SIZE = 28;
        const buf = Buffer.alloc(4 + table.length * ENTRY_SIZE);
        buf.writeUInt16LE(commandSetRoutingTable, 0);  // cmd
        buf.writeUInt16LE(table.length,           2);  // count

        let offset = 4;
        for (let i = 0; i < table.length; i++)
        {
            const r = table[i];
            const srcProtocol = typeof r.srcProtocol === "string" ? riff(r.srcProtocol) : r.srcProtocol;
            const dstProtocol = typeof r.dstProtocol === "string" ? riff(r.dstProtocol) : (r.dstProtocol ?? 0);
            buf.writeUInt32LE(srcProtocol,         offset);      offset += 4;
            writeU64LE(buf, r.srcCode, offset);                  offset += 8;
            buf.writeUInt32LE(dstProtocol,         offset);      offset += 4;
            writeU64LE(buf, r.dstCode ?? 0n, offset);            offset += 8;
            writeIPv4(buf, resolvedIps[i],         offset);      offset += 4;
        }

        return this.sendPacket(buf);
    }

    /**
     * Connects or disconnects a BLE slot on the device.
     * @param {number} slot - BLE slot index to connect, or `-1` to disconnect all.
     * @returns {Promise<void>}
     */
    bleConnect(slot)
    {
        return this.sendPacket([commandBleConnect, 0, slot < 0 ? 255 : slot]);
    }

    /**
     * Sends a BLE HID report through the device to a connected BLE peripheral.
     * @param {number} slot - BLE slot index of the target device.
     * @param {number} reportId - HID report ID (see {@link irtxHidReportId}).
     * @param {number[]} reportData - HID report payload bytes.
     * @returns {Promise<void>}
     */
    bleSendHid(slot, reportId, reportData)
    {
        return this.sendPacket([commandBleSendHid, 0, slot, reportId, ...reportData]);
    }
}
