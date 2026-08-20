import {
    prepareData,
    preparePreviewData,
    TemplateDataType
} from "Data/PrepareData.js";

import {
    TEMPLATE_FOLDER
} from "Config.js";

import {
    renderToImage
} from "./RenderHTML.js";

import {
    buildLiquid
} from "./BuildLiquid.js";

import crypto from "crypto";

import {
    readFileSync
} from "node:fs";


const headerHtml =
    readFileSync(
        TEMPLATE_FOLDER
        + '/Header.html',
        'utf8'
    );


let lastGoodLiveImage:
    Buffer | null =
    null;


// ============================================================
// COMMON RENDERER
// ============================================================

async function renderWeatherScreen(
    data: TemplateDataType
): Promise<Buffer> {

    const html =
        await buildLiquid(
            'Weather',
            data
        );


    /*
     * IMPORTANT:
     *
     * We return the clean PNG directly.
     * No PNGto1BIT conversion.
     */
    return renderToImage(
        headerHtml
        + html
    );
}


// ============================================================
// BROWSER PREVIEW
// ============================================================

export async function buildPreviewScreen():
Promise<Buffer> {

    const data =
        await preparePreviewData();


    return renderWeatherScreen(
        data
    );
}


// ============================================================
// LIVE REFRESH
// ============================================================

export async function refreshLiveScreen():
Promise<Buffer> {

    try {

        console.log(
            "Screen: attempting live weather refresh"
        );


        const data =
            await prepareData();


        const image =
            await renderWeatherScreen(
                data
            );


        lastGoodLiveImage =
            image;


        console.log(
            "Screen: live image updated successfully"
        );


        return image;

    } catch (error) {

        console.error(
            "Screen: live refresh failed",
            error
        );


        /*
         * Best case:
         * keep showing the last successful weather image.
         */
        if (lastGoodLiveImage) {

            console.warn(
                "Screen: keeping last good live image"
            );


            return lastGoodLiveImage;
        }


        /*
         * Fresh Render instance and weather API fails:
         * show our safe static preview rather than HTTP 500.
         */
        console.warn(
            "Screen: no previous live image; using preview fallback"
        );


        return buildPreviewScreen();
    }
}


// ============================================================
// SERVE LIVE IMAGE
// ============================================================

export async function getLiveScreen():
Promise<Buffer> {

    /*
     * /live-image NEVER calls Open-Meteo.
     *
     * The refresh already happened when Kindle requested
     * /api/display.
     */
    if (lastGoodLiveImage) {

        return lastGoodLiveImage;
    }


    return buildPreviewScreen();
}


// ============================================================
// HASH
// ============================================================

/*
 * BYOS calls this while building the /api/display response.
 *
 * THIS is where the live weather refresh happens.
 */
export async function getScreenHash():
Promise<string> {

    const image =
        await refreshLiveScreen();


    return crypto
        .createHash(
            'sha256'
        )
        .update(
            image
        )
        .digest(
            'hex'
        );
}


// ============================================================
// ORIGINAL HELPER
// ============================================================

export async function checkImageUrl(
    url: string
): Promise<boolean> {

    let response;


    try {

        response =
            await fetch(url);

    } catch (error: any) {

        console.error(
            `Failed to check image ${url} - ${error.message}`
        );


        return false;
    }


    if (!response.ok) {

        console.error(
            `Failed to check image ${url} - got ${response.status} code`
        );


        return false;
    }


    const data =
        await response.text();


    if (
        data.length
        <
        1000
    ) {

        console.error(
            `Failed to check image ${url} - no content`
        );


        return false;
    }


    return true;
}
