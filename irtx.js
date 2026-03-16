import dgram from "node:dgram";
import { EventEmitter } from "node:events";

const commandSendIr = 1;
const commandBleConnect = 2;
const commandBleSendHid = 3;
const commandSendIrCode = 4;
const commandSwitchActivity = 5;
const commandSimulateIr = 6;

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
 * @param {bigint | number} value
 * @param {number} offset
 */
function writeU64LE(buf, value, offset)
{
    const big = BigInt(value);
    buf.writeUInt32LE(Number(big & 0xFFFFFFFFn), offset);
    buf.writeUInt32LE(Number(big >> 32n),        offset + 4);
}

/**
 * Bitmask constants for the `eventKindMask` parameter of {@link IrtxDevice#simulateIr}.
 * @type {{ Press: 1, Repeat: 2, LongPress: 4, Release: 8 }}
 */
export const IrEventKind = {
    Press:     1,
    Repeat:    2,
    LongPress: 4,
    Release:   8,
};

/**
 * BLE HID report ID constants.
 * @type {{ keyboard: 1, consumer: 2, mouse: 3 }}
 */
export const irtxHidReportId = {
    keyboard: 1,
    consumer: 2,
    mouse: 3,
}

/**
 * @typedef {Object} IrSendOpts
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
     * irtx.on('ircode', ({ protocol, code, repeat }) => {
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

                const protocol    = msg.readUInt32LE(4);
                const codeLo      = BigInt(msg.readUInt32LE(8));
                const codeHi      = BigInt(msg.readUInt32LE(12));
                const code        = (codeHi << 32n) | codeLo;
                const repeat      = msg.readUInt8(16) !== 0;

                /**
                 * Fired when a cmd 4 (IR code) UDP packet is received.
                 * @event IrtxDevice#ircode
                 * @type {Object}
                 * @property {number}  protocol    - FourCC protocol identifier.
                 * @property {bigint}  code        - 64-bit IR code value.
                 * @property {boolean} repeat      - Whether this is a repeat frame.
                 * @property {string}  remoteAddress - IP address of the sender.
                 * @property {number}  remotePort    - UDP port of the sender.
                 */
                this.emit("ircode", { protocol, code, repeat, remoteAddress: rinfo.address, remotePort: rinfo.port });
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
            packet.writeUInt16LE(0, 2);     // unused, used to be device index
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
            packet.writeUInt16LE(0, 2); // unused used to be device index
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
     * Switches the active activity on the device by index.
     *
     * @param {number} index - Zero-based activity index to activate.
     * @returns {Promise<void>}
     */
    switchActivity(index)
    {
        const buf = Buffer.alloc(6);
        buf.writeUInt16LE(commandSwitchActivity, 0);
        buf.writeUInt32LE(index, 2);
        return this.sendPacket(buf);
    }

    /**
     * Simulates receipt of an IR code on the device, for testing purposes.
     *
     * @param {string | number} protocol - Protocol name (e.g. `"NEC"`) or FourCC number.
     * @param {string | number | bigint} code - IR code value.
     * @param {number} [eventKindMask=0] - Bitmask of {@link IrEventKind} values to fire directly.
     *   Pass `0` (default) to run through the normal edge-detection logic (synthesises Press/Repeat/Release).
     * @returns {Promise<void>}
     */
    simulateIr(protocol, code, eventKindMask = 0)
    {
        if (typeof protocol === "string")
            protocol = riff(protocol);

        if (typeof code === "string")
        {
            if (!code.startsWith("0x") && !code.startsWith("0X"))
                code = "0x" + code;
            code = BigInt(code);
        }

        // [uint16 cmd=6][uint32 protocol][uint64 code][uint32 eventKindMask]
        const buf = Buffer.alloc(18);
        buf.writeUInt16LE(commandSimulateIr, 0);
        buf.writeUInt32LE(protocol, 2);
        writeU64LE(buf, code, 6);
        buf.writeUInt32LE(eventKindMask, 14);
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
