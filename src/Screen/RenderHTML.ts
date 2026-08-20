import puppeteer, { Page } from "puppeteer";
import fs from 'fs/promises';
import { ASSETS_FOLDER, IS_TEST_ENV } from "Config.js";

export const BASE_URL_CHROME = 'http://localhost';


let page: Page;

export async function initPuppeteer() {
    if (page) {
        console.warn('Puppeteer already initialized');
        return;
    }
    if (!IS_TEST_ENV) {
        console.log('start of Puppeteer init');
    }
    const browser = await puppeteer.launch({
        headless: true,
        protocolTimeout: 30000,
        timeout: 30000,
        args: [
            '--no-sandbox',
            '--disable-web-security',
            '--disable-gpu',
        ]
    }
    );
    page = await browser.newPage();
    await page.setViewport({ width: 1024, height: 758 });
    await page.setRequestInterception(true);
    page.on('pageerror', (error: any) => console.error('Puppeteer error:', error.message));
    page.on('requestfailed', request => console.log(`Puppeteer failed: ${request.failure()?.errorText} ${request.url()}`));
    // page.on('console', message => console.log('console: ', message.text()));
    page.on('request', async (interceptedRequest) => {
        if (interceptedRequest.isInterceptResolutionHandled()) {
            return;
        }
        const url = interceptedRequest.url();
        if (!url.startsWith(BASE_URL_CHROME + '/assets/')) {
            await interceptedRequest.continue();
            return;
        }
        try {
            const filePathPart = url.replace(BASE_URL_CHROME + '/assets/', '/')
            const file = await fs.readFile(ASSETS_FOLDER + filePathPart);
            await interceptedRequest.respond({ body: file });
        } catch (error) {
            await interceptedRequest.abort();
        }
    });
    if (!IS_TEST_ENV) {
        console.log('end of Puppeteer init');
    }
}


export async function renderToImage(html: string) {
    await page.goto('about:blank');
    await page.setContent(html, { waitUntil: "load" });
    const image: Uint8Array = await page.screenshot();
    return Buffer.from(image);
}
