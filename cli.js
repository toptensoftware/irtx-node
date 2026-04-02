#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";
import { clargs, showPackageVersion, showArgs } from "@toptensoftware/clargs";
import { pack, registerType, registerEnum } from "@toptensoftware/binpack";
import { loadFile, buildCombinedBuffer } from "@toptensoftware/binpack/cli.js";
import { IrtxDevice } from "./irtx.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function showHelp()
{
    console.log("Usage: irtx [options] <command> [args]\n");
    console.log("Commands:");
    showArgs({
        "send <code>":                  "Send an IR code (e.g. NEC:0x20DF10EF)",
        "activities <file>":            "Pack a .js or .json activities config file, write .bin, and upload to device",
        "ble-connect <slot>":           "Connect BLE slot by index",
        "ble-disconnect":               "Disconnect all BLE slots",
        "ble-hid <reportId> <data...>":  "Send one or more BLE HID reports (reportId: 1=keyboard 2=consumer 3=mouse, data: hex digits, optional commas)",
        "ble-type <text>":              "Type an ASCII string as BLE HID keystrokes (US keyboard layout)",
        "ble-keys <key...>":            "Send BLE HID key events (!key = release, e.g: ctrl c !c !ctrl)",
    });
    console.log("\nOptions:");
    showArgs({
        "--host, -h <ip>":    "IP address or hostname of the irtx device (or set IRTX_HOST)",
        "--port, -p <port>":  "UDP port number for send command (default: 4210)",
        "--delay <ms>":       "Inter-packet delay for ble-hid/ble-keys (default: 30)",
        "--list-keys":        "List available key names for ble-keys",
        "--help":             "Show this help",
        "--version":          "Show version information",
    });
}

let host = process.env.IRTX_HOST ?? null;
let port = 4210;
let delay = 30;
let command = null;
let commandArgs = [];

const args = clargs();

while (args.next())
{
    switch (args.name)
    {
        case "help":
            showHelp();
            process.exit(0);
            break;

        case "version":
            showPackageVersion(path.join(__dirname, "package.json"));
            process.exit(0);
            break;

        case "h":
        case "host":
            host = args.readValue();
            break;

        case "p":
        case "port":
            port = args.readIntValue();
            break;

        case "delay":
            delay = args.readIntValue();
            break;

        case "list-keys":
            listKeys();
            process.exit(0);
            break;

        case null:
            if (command === null)
                command = args.readValue();
            else
                commandArgs.push(args.readValue());
            break;

        default:
            console.error(`Unknown option: --${args.name}`);
            process.exit(1);
    }
}

if (command === null)
{
    showHelp();
    process.exit(0);
}

switch (command)
{
    case "send":
    {
        if (!host)
        {
            console.error("Error: --host is required (or set the IRTX_HOST environment variable)");
            process.exit(1);
        }
        if (commandArgs.length === 0)
        {
            console.error("Usage: irtx send <code>  (e.g. NEC:0x20DF10EF)");
            process.exit(1);
        }
        const device = new IrtxDevice(host, port);
        try
        {
            await device.irSend(commandArgs[0]);
        }
        finally
        {
            device.close();
        }
        break;
    }

    case "activities":
    {
        if (!host)
        {
            console.error("Error: --host is required (or set the IRTX_HOST environment variable)");
            process.exit(1);
        }
        if (commandArgs.length === 0)
        {
            console.error("Usage: irtx activities <file.js|file.json>");
            process.exit(1);
        }
        await configure(host, commandArgs[0]);
        break;
    }

    case "ble-connect":
    {
        if (!host)
        {
            console.error("Error: --host is required (or set the IRTX_HOST environment variable)");
            process.exit(1);
        }
        if (commandArgs.length === 0)
        {
            console.error("Usage: irtx ble-connect <slot>");
            process.exit(1);
        }
        const slot = parseInt(commandArgs[0], 10);
        if (isNaN(slot) || slot < 0)
        {
            console.error("Error: slot must be a non-negative integer");
            process.exit(1);
        }
        const device = new IrtxDevice(host, port);
        try
        {
            await device.bleConnect(slot);
        }
        finally
        {
            device.close();
        }
        break;
    }

    case "ble-disconnect":
    {
        if (!host)
        {
            console.error("Error: --host is required (or set the IRTX_HOST environment variable)");
            process.exit(1);
        }
        const device = new IrtxDevice(host, port);
        try
        {
            await device.bleConnect(-1);
        }
        finally
        {
            device.close();
        }
        break;
    }

    case "ble-hid":
    {
        if (!host)
        {
            console.error("Error: --host is required (or set the IRTX_HOST environment variable)");
            process.exit(1);
        }
        if (commandArgs.length < 2)
        {
            console.error("Usage: irtx ble-hid <reportId> <hexdata> [<hexdata> ...]");
            process.exit(1);
        }
        const reportId = parseInt(commandArgs[0], 10);
        if (isNaN(reportId) || reportId < 1 || reportId > 255)
        {
            console.error("Error: reportId must be an integer between 1 and 255");
            process.exit(1);
        }
        const packets = [];
        for (let i = 1; i < commandArgs.length; i++)
        {
            if (commandArgs[i] === "!")
            {
                packets.push(null);
                continue;
            }
            const hexStr = commandArgs[i].replace(/,/g, "");
            if (!/^[0-9a-fA-F]*$/.test(hexStr) || hexStr.length % 2 !== 0)
            {
                console.error(`Error: hex data must be an even number of hex digits (optional commas allowed): ${commandArgs[i]}`);
                process.exit(1);
            }
            const reportData = [];
            for (let j = 0; j < hexStr.length; j += 2)
                reportData.push(parseInt(hexStr.slice(j, j + 2), 16));
            packets.push(reportData);
        }
        const device = new IrtxDevice(host, port);
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        try
        {
            for (let i = 0; i < packets.length; i++)
            {
                if (i > 0)
                    await sleep(delay);
                if (packets[i] !== null)
                    await device.bleSendHid(0xFF, reportId, packets[i]);
            }
        }
        finally
        {
            device.close();
        }
        break;
    }

    case "ble-type":
    {
        if (!host)
        {
            console.error("Error: --host is required (or set the IRTX_HOST environment variable)");
            process.exit(1);
        }
        if (commandArgs.length === 0)
        {
            console.error("Usage: irtx ble-type <text>");
            process.exit(1);
        }
        await bleType(host, port, commandArgs.join(" "));
        break;
    }

    case "ble-keys":
    {
        if (!host)
        {
            console.error("Error: --host is required (or set the IRTX_HOST environment variable)");
            process.exit(1);
        }
        if (commandArgs.length === 0)
        {
            console.error("Usage: irtx ble-keys <key...>  (prefix ! to release, e.g: ctrl c !c !ctrl)");
            process.exit(1);
        }
        await bleKeys(host, port, commandArgs, delay);
        break;
    }

    default:
        console.error(`Unknown command: ${command}`);
        process.exit(1);
}

// ---------------------------------------------------------------------------
// BLE HID keyboard typing
// ---------------------------------------------------------------------------

const SHIFT = 0x02;

function buildUsKeymap()
{
    const map = {};

    // Letters a-z / A-Z  (HID keycodes 0x04–0x1D)
    for (let i = 0; i < 26; i++)
    {
        const kc = 0x04 + i;
        map[String.fromCharCode(0x61 + i)] = [0,     kc]; // a-z
        map[String.fromCharCode(0x41 + i)] = [SHIFT, kc]; // A-Z
    }

    // Digit row: base character, shifted character, keycode
    for (const [base, shifted, kc] of [
        ['1', '!', 0x1E],
        ['2', '@', 0x1F],
        ['3', '#', 0x20],
        ['4', '$', 0x21],
        ['5', '%', 0x22],
        ['6', '^', 0x23],
        ['7', '&', 0x24],
        ['8', '*', 0x25],
        ['9', '(', 0x26],
        ['0', ')', 0x27],
    ])
    {
        map[base]    = [0,     kc];
        map[shifted] = [SHIFT, kc];
    }

    // Punctuation and whitespace
    for (const [base, shifted, kc] of [
        [' ',  null, 0x2C],
        ['\n', null, 0x28],
        ['\t', null, 0x2B],
        ['-',  '_',  0x2D],
        ['=',  '+',  0x2E],
        ['[',  '{',  0x2F],
        [']',  '}',  0x30],
        ['\\', '|',  0x31],
        [';',  ':',  0x33],
        ["'",  '"',  0x34],
        ['`',  '~',  0x35],
        [',',  '<',  0x36],
        ['.',  '>',  0x37],
        ['/',  '?',  0x38],
    ])
    {
        map[base] = [0, kc];
        if (shifted !== null)
            map[shifted] = [SHIFT, kc];
    }

    return map;
}

const usKeymap = buildUsKeymap();

async function bleType(host, port, text)
{
    const device = new IrtxDevice(host, port);
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    try
    {
        for (const ch of text)
        {
            const mapping = usKeymap[ch];
            if (!mapping)
            {
                console.warn(`Warning: no keymap entry for ${JSON.stringify(ch)}, skipping`);
                continue;
            }

            const [modifier, keycode] = mapping;

            // Key press: [modifier, reserved, keycode, 0, 0, 0, 0, 0]
            await device.bleSendHid(0xFF, 1, [modifier, 0x00, keycode, 0, 0, 0, 0, 0]);
            await sleep(20);

            // Key release
            await device.bleSendHid(0xFF, 1, [0, 0, 0, 0, 0, 0, 0, 0]);
            await sleep(30);
        }
    }
    finally
    {
        device.close();
    }
}

// ---------------------------------------------------------------------------
// BLE HID key names
// ---------------------------------------------------------------------------

// Modifier key name -> bitmask
const modifierBits = {
    ctrl:   0x01, lctrl:  0x01,
    shift:  0x02, lshift: 0x02,
    alt:    0x04, lalt:   0x04,
    gui:    0x08, win:    0x08, cmd:   0x08, lgui: 0x08, lwin: 0x08,
    rctrl:  0x10,
    rshift: 0x20,
    ralt:   0x40, altgr:  0x40,
    rgui:   0x80, rwin:   0x80,
};

// Regular key name -> HID keycode
const keyNames = {
    // Letters
    a: 0x04, b: 0x05, c: 0x06, d: 0x07, e: 0x08, f: 0x09, g: 0x0A,
    h: 0x0B, i: 0x0C, j: 0x0D, k: 0x0E, l: 0x0F, m: 0x10, n: 0x11,
    o: 0x12, p: 0x13, q: 0x14, r: 0x15, s: 0x16, t: 0x17, u: 0x18,
    v: 0x19, w: 0x1A, x: 0x1B, y: 0x1C, z: 0x1D,
    // Digits
    '1': 0x1E, '2': 0x1F, '3': 0x20, '4': 0x21, '5': 0x22,
    '6': 0x23, '7': 0x24, '8': 0x25, '9': 0x26, '0': 0x27,
    // Whitespace / editing
    enter: 0x28, return: 0x28,
    esc: 0x29, escape: 0x29,
    backspace: 0x2A, bksp: 0x2A,
    tab: 0x2B,
    space: 0x2C,
    // Punctuation (unshifted names)
    minus: 0x2D, equals: 0x2E,
    lbracket: 0x2F, rbracket: 0x30,
    backslash: 0x31, semicolon: 0x33,
    apostrophe: 0x34, grave: 0x35,
    comma: 0x36, period: 0x37, slash: 0x38,
    // Lock / system
    capslock: 0x39, scrolllock: 0x47, numlock: 0x53,
    printscreen: 0x46, prtscr: 0x46,
    pause: 0x48,
    // Navigation
    insert: 0x49, ins: 0x49,
    home: 0x4A,
    pageup: 0x4B, pgup: 0x4B,
    delete: 0x4C, del: 0x4C,
    end: 0x4D,
    pagedown: 0x4E, pgdn: 0x4E,
    right: 0x4F, left: 0x50, down: 0x51, up: 0x52,
    // Function keys
    f1:  0x3A, f2:  0x3B, f3:  0x3C, f4:  0x3D,
    f5:  0x3E, f6:  0x3F, f7:  0x40, f8:  0x41,
    f9:  0x42, f10: 0x43, f11: 0x44, f12: 0x45,
    // Misc
    app: 0x65, menu: 0x65,
};

function listKeys()
{
    console.log("Modifier keys (can be combined with regular keys):");
    console.log("  ctrl lctrl  shift lshift  alt lalt  gui win cmd lgui lwin");
    console.log("  rctrl  rshift  ralt altgr  rgui rwin\n");
    console.log("Regular keys:");
    console.log("  a-z  0-9  f1-f12");
    console.log("  enter return  esc escape  backspace bksp  tab  space");
    console.log("  insert ins  delete del  home  end  pageup pgup  pagedown pgdn");
    console.log("  up  down  left  right");
    console.log("  capslock  scrolllock  numlock  printscreen prtscr  pause");
    console.log("  minus  equals  lbracket  rbracket  backslash");
    console.log("  semicolon  apostrophe  grave  comma  period  slash");
    console.log("  app menu\n");
    console.log("Prefix a key name with ! to release it.  e.g: ctrl c !c !ctrl");
}

function lookupKey(name)
{
    const mod = modifierBits[name];
    if (mod !== undefined)
        return { type: "modifier", value: mod };
    const kc = keyNames[name];
    if (kc !== undefined)
        return { type: "key", value: kc };
    return null;
}

async function bleKeys(host, port, tokens, delayMs)
{
    // Validate all tokens up front
    for (const token of tokens)
    {
        const name = (token.startsWith("!") ? token.slice(1) : token).toLowerCase();
        if (!lookupKey(name))
        {
            console.error(`Error: unknown key name "${name}" (use --list-keys to see available keys)`);
            process.exit(1);
        }
    }

    let modifiers = 0;
    let activeKeys = [];  // active HID keycodes

    const device = new IrtxDevice(host, port);
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    function buildReport()
    {
        const report = [modifiers, 0x00, 0, 0, 0, 0, 0, 0];
        for (let i = 0; i < Math.min(activeKeys.length, 6); i++)
            report[2 + i] = activeKeys[i];
        return report;
    }

    try
    {
        let first = true;
        for (const token of tokens)
        {
            const release = token.startsWith("!");
            const key = lookupKey((release ? token.slice(1) : token).toLowerCase());

            if (!first)
                await sleep(delayMs);
            first = false;

            if (key.type === "modifier")
            {
                if (release)
                    modifiers &= ~key.value;
                else
                    modifiers |= key.value;
            }
            else
            {
                if (release)
                    activeKeys = activeKeys.filter(k => k !== key.value);
                else if (!activeKeys.includes(key.value))
                    activeKeys.push(key.value);
            }

            await device.bleSendHid(0xFF, 1, buildReport());
        }

        // Auto-release any still-held keys
        if (modifiers !== 0 || activeKeys.length > 0)
        {
            await sleep(delayMs);
            await device.bleSendHid(0xFF, 1, [0, 0, 0, 0, 0, 0, 0, 0]);
        }
    }
    finally
    {
        device.close();
    }
}

// ---------------------------------------------------------------------------

async function uploadFile(host, data, filename, mimeType = "application/octet-stream")
{
    const form = new FormData();
    form.append("file", new Blob([data], { type: mimeType }), filename);
    const r = await fetch(`http://${host}/api/upload?filename=${encodeURIComponent(filename)}`, {
        method: "POST",
        body: form,
    });
    if (!r.ok)
        throw new Error(`Upload of ${filename} failed: ${r.status} ${r.statusText}`);
    console.log(`Uploaded: ${filename} (${data.length} bytes)`);
}

async function configure(host, dataFile)
{
    // Fetch type definitions from device
    const typeDefsResponse = await fetch(`http://${host}/binpack.js`);
    if (!typeDefsResponse.ok)
        throw new Error(`Failed to fetch type definitions: ${typeDefsResponse.status} ${typeDefsResponse.statusText}`);
    const typeDefsSource = await typeDefsResponse.text();

    // Register a module hook so activities.js can use:
    //   import { op, riff, opId, ... } from "binpack:types"
    register("./irtx-loader.js", {
        parentURL: import.meta.url,
        data: { source: typeDefsSource },
    });

    // Import type defs through the hook (also caches the module for activities.js)
    const { default: typeDefs } = await import("binpack:types");

    // Register types with binpack
    for (const def of typeDefs)
    {
        if (def.fields)
            registerType(def);
        else if (def.enum)
            registerEnum(def.name, def.enum);
    }

    const rootType = typeDefs.find(x => x.fields)?.name;
    if (!rootType)
        throw new Error("No root type found in type definitions");

    // Load and pack the data file (its "binpack:types" imports are served by the hook)
    const data = await loadFile(dataFile);
    const packResult = pack(rootType, data);
    const buffer = buildCombinedBuffer(packResult);

    // Always write the .bin file locally
    const outFile = path.join(path.dirname(path.resolve(dataFile)),
                              path.basename(dataFile, path.extname(dataFile)) + ".bin");
    fs.writeFileSync(outFile, buffer);
    console.log(`Written: ${outFile} (${buffer.length} bytes)`);

    // Upload binary and source, then trigger reload
    await uploadFile(host, buffer, "activities.bin");
    await uploadFile(host, fs.readFileSync(dataFile), "activities.js", "application/javascript");

    const reloadResponse = await fetch(`http://${host}/api/reload-activities`, { method: "POST" });
    if (!reloadResponse.ok)
        throw new Error(`Reload failed: ${reloadResponse.status} ${reloadResponse.statusText}`);
    console.log("Activities reloaded.");
}
