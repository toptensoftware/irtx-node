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

const IRTX_BINPACK_URL = "https://raw.githubusercontent.com/toptensoftware/irtx/main/binpack.js";

function showHelp()
{
    console.log("Usage: irtx [options] <command> [args]\n");
    console.log("Commands:");
    showArgs({
        "send <code>":                  "Send an IR code (e.g. NEC:0x20DF10EF)",
        "configure <file>":             "Pack a .js or .json activities config file and upload to device (or write .bin if no --host)",
        "ble-connect <slot>":           "Connect BLE slot by index",
        "ble-disconnect":               "Disconnect all BLE slots",
        "ble-hid <reportId> <data...>":  "Send one or more BLE HID reports (reportId: 1=keyboard 2=consumer 3=mouse, data: hex digits, optional commas)",
        "ble-type <text>":              "Type an ASCII string as BLE HID keystrokes (US keyboard layout)",
    });
    console.log("\nOptions:");
    showArgs({
        "--host, -h <ip>":    "IP address or hostname of the irtx device (or set IRTX_HOST)",
        "--port, -p <port>":  "UDP port number for send command (default: 4210)",
        "--help":             "Show this help",
        "--version":          "Show version information",
    });
}

let host = process.env.IRTX_HOST ?? null;
let port = 4210;
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

    case "configure":
    {
        if (commandArgs.length === 0)
        {
            console.error("Usage: irtx configure <file.js|file.json>");
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
            if (commandArgs[i] === "-")
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
                    await sleep(30);
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

async function configure(host, dataFile)
{
    // Fetch type definitions from irtx repo
    const typeDefsResponse = await fetch(IRTX_BINPACK_URL);
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

    if (host)
    {
        // POST to device as multipart upload (matches Arduino WebServer upload handler)
        const form = new FormData();
        form.append("file", new Blob([buffer], { type: "application/octet-stream" }), "activities.bin");

        const postResponse = await fetch(`http://${host}/activities`, {
            method: "POST",
            body: form,
        });

        if (!postResponse.ok)
            throw new Error(`Upload failed: ${postResponse.status} ${postResponse.statusText}`);

        console.log(`Configured: ${buffer.length} bytes uploaded to ${host}`);
    }
    else
    {
        const outFile = path.join(path.dirname(path.resolve(dataFile)),
                                  path.basename(dataFile, path.extname(dataFile)) + ".bin");
        fs.writeFileSync(outFile, buffer);
        console.log(`Written: ${outFile} (${buffer.length} bytes)`);
    }
}
