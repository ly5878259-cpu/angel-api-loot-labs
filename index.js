const express = require('express');
const WebSocket = require('ws');
const puppeteer = require('puppeteer');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
app.use(express.json());

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';

function decodeURIData(encodedString, prefixLength = 5) {
    const base64Decoded = Buffer.from(encodedString, 'base64').toString('binary');
    const prefix = base64Decoded.substring(0, prefixLength);
    const body = base64Decoded.substring(prefixLength);
    let decoded = '';
    for (let i = 0; i < body.length; i++) {
        decoded += String.fromCharCode(body.charCodeAt(i) ^ prefix.charCodeAt(i % prefix.length));
    }
    return decoded;
}

async function getLootData(url) {
    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox','--disable-setuid-sandbox','--disable-blink-features=AutomationControlled','--disable-infobars'],
        executablePath: '/usr/bin/chromium-browser'
    });

    const page = await browser.newPage();
    let loot = null;

    page.on('response', async res => {
        try {
            const text = await res.text();
            if (text.includes('urid')) {
                const json = JSON.parse(text);
                const item = Array.isArray(json) ? json[0] : json;
                if (item?.urid) {
                    loot = { urid: item.urid, pixel: item.action_pixel_url, task_id: item.task_id || 8 };
                }
            }
        } catch {}
    });

    await page.setUserAgent(UA);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await new Promise(r => setTimeout(r, 8000));

    const html = await page.content();
    const $ = cheerio.load(html);

    let KEY = null, TID = null;
    $('script').each((i, el) => {
        const c = $(el).html();
        if (!c) return;
        const k = c.match(/KEY'\]\s*=\s*["'](\d+)["']/);
        const t = c.match(/TID'\]\s*=\s*(\d+)/);
        if (k) KEY = k[1];
        if (t) TID = t[1];
    });

    if (!loot || !KEY) {
        await browser.close();
        throw new Error("Failed extract");
    }

    return { ...loot, KEY, TID, browser };
}

async function resolve(data) {
    const host = `0.${data.SERVER || 'onsultingco.com'}`;
    const ws = new WebSocket(`wss://${host}/c?uid=${data.urid}&cat=${data.task_id}&key=${data.KEY}`);
    return new Promise((resolve, reject) => {
        let result = "";
        ws.on('message', (msg) => { const m = msg.toString(); if (m.startsWith('r:')) result = m.replace('r:', ''); });
        ws.on('close', () => { if (result) resolve(result); else reject("no result"); });
        ws.on('error', reject);
    });
}

app.get('/bypass', async (req, res) => {
    try {
        const raw = req.originalUrl.split('?url=')[1];
        if (!raw) return res.json({ error: "missing url" });

        const url = decodeURIComponent(raw);
        const data = await getLootData(url);
        const encoded = await resolve(data);

        let final = decodeURIComponent(decodeURIData(encoded));
        final = final.replace(/\f/g, '').trim();
        await data.browser.close();

        res.json({ success: true, result: final });
    } catch (e) {
        res.json({ success: false, error: e.toString() });
    }
});

const PORT = process.env.PORT || 3100;
app.listen(PORT, () => console.log("Server running on port " + PORT));
